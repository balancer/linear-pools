import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { setCode } from '@nomicfoundation/hardhat-network-helpers';
import * as expectEvent from '@orbcollective/shared-dependencies/expectEvent';

import { bn, fp, FP_ONE } from '@orbcollective/shared-dependencies/numbers';
import {
  MAX_UINT256,
  getExternalPackageDeployedAt,
  getExternalPackageArtifact,
} from '@orbcollective/shared-dependencies';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { SwapKind } from '@balancer-labs/balancer-js';

import { describeForkTest } from '../../../src/forkTests';
import { impersonate, getForkedNetwork, Task, TaskMode, getSigners } from '../../../src';

describeForkTest('MidasLinearPoolFactory', 'bsc', 23696722, function () {
  let owner: SignerWithAddress, holder: SignerWithAddress, other: SignerWithAddress;
  let factory: Contract, vault: Contract, brz: Contract;
  let rebalancer: Contract;

  let task: Task;

  const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
  const cWBNB = '0x38982105A2F81dc5dBDEA6c131bB4bF5a416513A';

  const WBNB_SCALING = bn(1); // BRZ has 18 decimals, so its scaling factor is 1e0

  const WBNB_HOLDER = '0x58f876857a02d6762e0101bb5c46a8c1ed44dc16';

  const SWAP_FEE_PERCENTAGE = fp(0.01); // 1%

  // The targets are set using 18 decimals, even if the token has fewer (as is the case for BRZ);
  const INITIAL_UPPER_TARGET = fp(1e4);

  // The initial midpoint (upper target / 2) must be between the final lower and upper targets
  const FINAL_LOWER_TARGET = fp(0.2e4);
  const FINAL_UPPER_TARGET = fp(5e4);

  const PROTOCOL_ID = 0;

  let pool: Contract;
  let poolId: string;

  before('run task', async () => {
    task = new Task('20221130-midas-linear-pool', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    factory = await task.deployedInstance('MidasLinearPoolFactory');
  });

  before('load signers', async () => {
    [, owner, other] = await getSigners();

    holder = await impersonate(WBNB_HOLDER, fp(100));
  });

  before('setup contracts', async () => {
    vault = await new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre)).deployedInstance('Vault');

    brz = await task.instanceAt('IERC20', WBNB);
    await brz.connect(holder).approve(vault.address, MAX_UINT256);
  });

  enum LinearPoolState {
    BALANCED,
    MAIN_EXCESS,
    MAIN_LACK,
  }

  function itRebalancesThePool(expectedState: LinearPoolState) {
    it('rebalance the pool', async () => {
      const { lowerTarget, upperTarget } = await pool.getTargets();

      const { cash } = await vault.getPoolTokenInfo(poolId, WBNB);
      const scaledCash = cash.mul(WBNB_SCALING);

      let fees;
      if (scaledCash.gt(upperTarget)) {
        expect(expectedState).to.equal(LinearPoolState.MAIN_EXCESS);

        const excess = scaledCash.sub(upperTarget);
        fees = excess.mul(SWAP_FEE_PERCENTAGE).div(FP_ONE);
      } else if (scaledCash.lt(lowerTarget)) {
        expect(expectedState).to.equal(LinearPoolState.MAIN_LACK);

        const lack = lowerTarget.sub(scaledCash);
        fees = lack.mul(SWAP_FEE_PERCENTAGE).div(FP_ONE);
      } else {
        expect(expectedState).to.equal(LinearPoolState.BALANCED);

        fees = 0;
      }

      const initialRecipientMainBalance = await brz.balanceOf(other.address);

      if (expectedState != LinearPoolState.BALANCED) {
        await rebalancer.connect(holder).rebalance(other.address);
      } else {
        await rebalancer.connect(holder).rebalanceWithExtraMain(other.address, 5);
      }

      const finalRecipientMainBalance = await brz.balanceOf(other.address);

      if (fees > 0) {
        // The recipient of the rebalance call should get the fees that were collected (though there's some rounding
        // error in the main-wrapped conversion).
        expect(finalRecipientMainBalance.sub(initialRecipientMainBalance)).to.be.almostEqual(
          fees.div(WBNB_SCALING),
          0.00000001
        );
      } else {
        // The recipient of the rebalance call will get any extra main tokens that were not utilized.
        expect(finalRecipientMainBalance).to.be.almostEqual(initialRecipientMainBalance, 0.00000001);
      }

      const mainInfo = await vault.getPoolTokenInfo(poolId, WBNB);

      const expectedMainBalance = lowerTarget.add(upperTarget).div(2);
      expect(mainInfo.cash.mul(WBNB_SCALING)).to.equal(expectedMainBalance);
      expect(mainInfo.managed).to.equal(0);
    });
  }

  describe('create and check getters', () => {
    it('deploy a linear pool', async () => {
      const tx = await factory.create(
        '',
        '',
        WBNB,
        cWBNB,
        INITIAL_UPPER_TARGET,
        SWAP_FEE_PERCENTAGE,
        owner.address,
        PROTOCOL_ID
      );
      const event = expectEvent.inReceipt(await tx.wait(), 'PoolCreated');

      pool = await task.instanceAt('MidasLinearPool', event.args.pool);
      expect(await factory.isPoolFromFactory(pool.address)).to.be.true;

      poolId = await pool.getPoolId();
      const [registeredAddress] = await vault.getPool(poolId);
      expect(registeredAddress).to.equal(pool.address);

      const { assetManager } = await vault.getPoolTokenInfo(poolId, WBNB); // We could query for either BRZ or cBRZ
      rebalancer = await task.instanceAt('MidasLinearPoolRebalancer', assetManager);

      await brz.connect(holder).approve(rebalancer.address, MAX_UINT256); // To send extra main on rebalance
    });

    it('check factory version', async () => {
      const expectedFactoryVersion = {
        name: 'MidasLinearPoolFactory',
        version: 1,
        deployment: '20221130-midas-linear-pool',
      };

      expect(await factory.version()).to.equal(JSON.stringify(expectedFactoryVersion));
    });

    it('check pool version', async () => {
      const expectedPoolVersion = {
        name: 'MidasLinearPool',
        version: 1,
        deployment: '20221130-midas-linear-pool',
      };

      expect(await pool.version()).to.equal(JSON.stringify(expectedPoolVersion));
    });
  });

  describe('join, and rebalance', () => {
    it('join the pool', async () => {
      // We're going to join with enough main token to bring the Pool above its upper target, which will let us later
      // rebalance.

      const joinAmount = INITIAL_UPPER_TARGET.mul(2).div(WBNB_SCALING);

      await vault
        .connect(holder)
        .swap(
          { kind: SwapKind.GivenIn, poolId, assetIn: WBNB, assetOut: pool.address, amount: joinAmount, userData: '0x' },
          { sender: holder.address, recipient: holder.address, fromInternalBalance: false, toInternalBalance: false },
          0,
          MAX_UINT256
        );

      // Assert join amount - some fees will be collected as we're going over the upper target.
      const excess = joinAmount.mul(WBNB_SCALING).sub(INITIAL_UPPER_TARGET);
      const joinCollectedFees = excess.mul(SWAP_FEE_PERCENTAGE).div(FP_ONE);

      const expectedBPT = joinAmount.mul(WBNB_SCALING).sub(joinCollectedFees);
      expect(await pool.balanceOf(holder.address)).to.equal(expectedBPT);
    });

    itRebalancesThePool(LinearPoolState.MAIN_EXCESS);

    it('set final targets', async () => {
      await pool.connect(owner).setTargets(FINAL_LOWER_TARGET, FINAL_UPPER_TARGET);
    });
  });

  describe('generate excess of main token and rebalance', () => {
    it('deposit main tokens', async () => {
      // We're going to join with enough main token to bring the Pool above its upper target, which will let us later
      // rebalance.

      const { upperTarget } = await pool.getTargets();
      const joinAmount = upperTarget.mul(5).div(WBNB_SCALING);

      await vault
        .connect(holder)
        .swap(
          { kind: SwapKind.GivenIn, poolId, assetIn: WBNB, assetOut: pool.address, amount: joinAmount, userData: '0x' },
          { sender: holder.address, recipient: holder.address, fromInternalBalance: false, toInternalBalance: false },
          0,
          MAX_UINT256
        );
    });

    itRebalancesThePool(LinearPoolState.MAIN_EXCESS);
  });

  describe('generate lack of main token and rebalance', () => {
    it('withdraw main tokens', async () => {
      // We're going to withdraw enough man token to bring the Pool below its lower target, which will let us later
      // rebalance.

      const { cash } = await vault.getPoolTokenInfo(poolId, WBNB);
      const scaledCash = cash.mul(WBNB_SCALING);
      const { lowerTarget } = await pool.getTargets();

      const exitAmount = scaledCash.sub(lowerTarget.div(3)).div(WBNB_SCALING);

      await vault.connect(holder).swap(
        {
          kind: SwapKind.GivenOut,
          poolId,
          assetIn: pool.address,
          assetOut: WBNB,
          amount: exitAmount,
          userData: '0x',
        },
        { sender: holder.address, recipient: holder.address, fromInternalBalance: false, toInternalBalance: false },
        MAX_UINT256,
        MAX_UINT256
      );
    });

    itRebalancesThePool(LinearPoolState.MAIN_LACK);
  });

  describe('join below upper target and rebalance', () => {
    it('deposit main tokens', async () => {
      // We're going to join with few tokens, causing the Pool to not reach its upper target.

      const { lowerTarget, upperTarget } = await pool.getTargets();
      const midpoint = lowerTarget.add(upperTarget).div(2);

      const joinAmount = midpoint.div(100).div(WBNB_SCALING);

      await vault
        .connect(holder)
        .swap(
          { kind: SwapKind.GivenIn, poolId, assetIn: WBNB, assetOut: pool.address, amount: joinAmount, userData: '0x' },
          { sender: holder.address, recipient: holder.address, fromInternalBalance: false, toInternalBalance: false },
          0,
          MAX_UINT256
        );
    });

    itRebalancesThePool(LinearPoolState.BALANCED);
  });

  describe('exit above lower target and rebalance', () => {
    it('withdraw main tokens', async () => {
      // We're going to exit with few tokens, causing for the Pool to not reach its lower target.

      const { lowerTarget, upperTarget } = await pool.getTargets();
      const midpoint = lowerTarget.add(upperTarget).div(2);

      const exitAmount = midpoint.div(100).div(WBNB_SCALING);

      await vault.connect(holder).swap(
        {
          kind: SwapKind.GivenOut,
          poolId,
          assetIn: pool.address,
          assetOut: WBNB,
          amount: exitAmount,
          userData: '0x',
        },
        { sender: holder.address, recipient: holder.address, fromInternalBalance: false, toInternalBalance: false },
        MAX_UINT256,
        MAX_UINT256
      );
    });

    itRebalancesThePool(LinearPoolState.BALANCED);
  });

  describe('rebalance repeatedly', () => {
    itRebalancesThePool(LinearPoolState.BALANCED);
    itRebalancesThePool(LinearPoolState.BALANCED);
  });

  describe('rebalancer query protection', () => {
    it('reverts with a malicious lending pool', async () => {
      const { cash } = await vault.getPoolTokenInfo(poolId, WBNB);
      const scaledCash = cash.mul(WBNB_SCALING);
      const { lowerTarget } = await pool.getTargets();

      const exitAmount = scaledCash.sub(lowerTarget.div(3)).div(WBNB_SCALING);

      await vault.connect(holder).swap(
        {
          kind: SwapKind.GivenOut,
          poolId,
          assetIn: pool.address,
          assetOut: WBNB,
          amount: exitAmount,
          userData: '0x',
        },
        { sender: holder.address, recipient: holder.address, fromInternalBalance: false, toInternalBalance: false },
        MAX_UINT256,
        MAX_UINT256
      );

      await setCode(cWBNB, getExternalPackageArtifact('linear-pools/MockCToken').deployedBytecode);
      const mockMaliciousMidasToken = await getExternalPackageDeployedAt('linear-pools/MockCToken', cWBNB);

      await mockMaliciousMidasToken.setRevertType(2); // Type 2 is malicious swap query revert
      await expect(rebalancer.rebalance(other.address)).to.be.revertedWith('BAL#357'); // MALICIOUS_QUERY_REVERT
    });
  });
});
