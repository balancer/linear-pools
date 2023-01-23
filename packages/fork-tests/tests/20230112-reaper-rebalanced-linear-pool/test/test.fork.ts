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

import { impersonate, getForkedNetwork, Task, TaskMode, getSigners } from '../../../src';
import { describeForkTest } from '../../../src/forkTests';

export enum SwapKind {
  GivenIn = 0,
  GivenOut,
}

describeForkTest('ReaperLinearPoolFactory', 'optimism', 69793811, function () {
  let owner: SignerWithAddress, holder: SignerWithAddress, other: SignerWithAddress;
  let factory: Contract, vault: Contract, mainToken: Contract;
  let rebalancer: Contract;

  let task: Task;

  const DAI = '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1';
  const rfsoDAI = '0x19Ca00D242e96A30A1cad12f08C375cAa989628F';

  const DAI_SCALING = bn(1); // DAI has 18 decimals, so its scaling factor is 1

  const DAI_HOLDER = '0xad32aa4bff8b61b4ae07e3ba437cf81100af0cd7';

  const SWAP_FEE_PERCENTAGE = fp(0.01); // 1%

  // The targets are set using 18 decimals, even if the token has fewer (as is the case for USDC);
  const INITIAL_UPPER_TARGET = fp(1e2);

  // The initial midpoint (upper target / 2) must be between the final lower and upper targets
  const FINAL_LOWER_TARGET = fp(0.2e2);
  const FINAL_UPPER_TARGET = fp(5e2);

  const PROTOCOL_ID = 1;

  let pool: Contract;
  let poolId: string;

  before('run task', async () => {
    task = new Task('20230112-reaper-rebalanced-linear-pool', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    factory = await task.deployedInstance('ReaperLinearPoolFactory');
  });

  before('load signers', async () => {
    [, owner, other] = await getSigners();

    holder = await impersonate(DAI_HOLDER, fp(100));
  });

  before('setup contracts', async () => {
    vault = await new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre)).deployedInstance('Vault');

    mainToken = await task.instanceAt('IERC20', DAI);
    await mainToken.connect(holder).approve(vault.address, MAX_UINT256);
  });

  enum LinearPoolState {
    BALANCED,
    MAIN_EXCESS,
    MAIN_LACK,
  }

  function itRebalancesThePool(expectedState: LinearPoolState) {
    it('rebalance the pool', async () => {
      const { lowerTarget, upperTarget } = await pool.getTargets();

      const { cash } = await vault.getPoolTokenInfo(poolId, DAI);
      const scaledCash = cash.mul(DAI_SCALING);

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

      const initialRecipientMainBalance = await mainToken.balanceOf(other.address);
      if (expectedState != LinearPoolState.BALANCED) {
        await rebalancer.connect(holder).rebalance(other.address);
      } else {
        await rebalancer.connect(holder).rebalanceWithExtraMain(other.address, 5);
      }
      const finalRecipientMainBalance = await mainToken.balanceOf(other.address);

      if (fees > 0) {
        // The recipient of the rebalance call should get the fees that were collected (though there's some rounding
        // error in the main-wrapped conversion).
        expect(finalRecipientMainBalance.sub(initialRecipientMainBalance)).to.be.almostEqual(
          fees.div(DAI_SCALING),
          0.00000001
        );
      } else {
        // The recipient of the rebalance call will get any extra main tokens that were not utilized.
        expect(finalRecipientMainBalance).to.be.almostEqual(initialRecipientMainBalance, 0.00000001);
      }

      const mainInfo = await vault.getPoolTokenInfo(poolId, DAI);

      const expectedMainBalance = lowerTarget.add(upperTarget).div(2);
      expect(mainInfo.cash.mul(DAI_SCALING)).to.equal(expectedMainBalance);
      expect(mainInfo.managed).to.equal(0);
    });
  }

  describe('create and check getters', () => {
    it('deploy a linear pool', async () => {
      const tx = await factory.create(
        'DAI',
        'rf-a-DAI',
        DAI,
        rfsoDAI,
        INITIAL_UPPER_TARGET,
        SWAP_FEE_PERCENTAGE,
        owner.address,
        PROTOCOL_ID
      );
      const event = expectEvent.inReceipt(await tx.wait(), 'PoolCreated');

      pool = await task.instanceAt('ReaperLinearPool', event.args.pool);
      expect(await factory.isPoolFromFactory(pool.address)).to.be.true;

      poolId = await pool.getPoolId();
      const [registeredAddress] = await vault.getPool(poolId);
      expect(registeredAddress).to.equal(pool.address);

      const { assetManager } = await vault.getPoolTokenInfo(poolId, DAI); // We could query for either DAI or rfToken
      rebalancer = await task.instanceAt('ReaperLinearPoolRebalancer', assetManager);

      await mainToken.connect(holder).approve(rebalancer.address, MAX_UINT256); // To send extra main on rebalance
    });

    it('check factory version', async () => {
      const expectedFactoryVersion = {
        name: 'ReaperLinearPoolFactory',
        version: 1,
        deployment: '20230112-reaper-rebalanced-linear-pool',
      };

      expect(await factory.version()).to.equal(JSON.stringify(expectedFactoryVersion));
    });

    it('check pool version', async () => {
      const expectedPoolVersion = {
        name: 'ReaperLinearPool',
        version: 1,
        deployment: '20230112-reaper-rebalanced-linear-pool',
      };

      expect(await pool.version()).to.equal(JSON.stringify(expectedPoolVersion));
    });
  });

  describe('join, and rebalance', () => {
    it('join the pool', async () => {
      // We're going to join with enough main token to bring the Pool above its upper target, which will let us later
      // rebalance.

      const joinAmount = INITIAL_UPPER_TARGET.mul(2).div(DAI_SCALING);

      await vault.connect(holder).swap(
        {
          kind: SwapKind.GivenIn,
          poolId,
          assetIn: DAI,
          assetOut: pool.address,
          amount: joinAmount,
          userData: '0x',
        },
        { sender: holder.address, recipient: holder.address, fromInternalBalance: false, toInternalBalance: false },
        0,
        MAX_UINT256
      );

      // Assert join amount - some fees will be collected as we're going over the upper target.
      const excess = joinAmount.mul(DAI_SCALING).sub(INITIAL_UPPER_TARGET);
      const joinCollectedFees = excess.mul(SWAP_FEE_PERCENTAGE).div(FP_ONE);

      const expectedBPT = joinAmount.mul(DAI_SCALING).sub(joinCollectedFees);

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
      const joinAmount = upperTarget.mul(5).div(DAI_SCALING);

      await vault.connect(holder).swap(
        {
          kind: SwapKind.GivenIn,
          poolId,
          assetIn: DAI,
          assetOut: pool.address,
          amount: joinAmount,
          userData: '0x',
        },
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

      const { cash } = await vault.getPoolTokenInfo(poolId, DAI);
      const scaledCash = cash.mul(DAI_SCALING);
      const { lowerTarget } = await pool.getTargets();

      const exitAmount = scaledCash.sub(lowerTarget.div(3)).div(DAI_SCALING);

      await vault.connect(holder).swap(
        {
          kind: SwapKind.GivenOut,
          poolId,
          assetIn: pool.address,
          assetOut: DAI,
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

      const joinAmount = midpoint.div(100).div(DAI_SCALING);

      await vault.connect(holder).swap(
        {
          kind: SwapKind.GivenIn,
          poolId,
          assetIn: DAI,
          assetOut: pool.address,
          amount: joinAmount,
          userData: '0x',
        },
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

      const exitAmount = midpoint.div(100).div(DAI_SCALING);

      await vault.connect(holder).swap(
        {
          kind: SwapKind.GivenOut,
          poolId,
          assetIn: pool.address,
          assetOut: DAI,
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

  describe('rebalancer query protection', async () => {
    it('reverts with a malicious lending pool', async () => {
      const { cash } = await vault.getPoolTokenInfo(poolId, DAI);
      const scaledCash = cash.mul(DAI_SCALING);
      const { lowerTarget } = await pool.getTargets();

      const exitAmount = scaledCash.sub(lowerTarget.div(3)).div(DAI_SCALING);

      await vault.connect(holder).swap(
        {
          kind: SwapKind.GivenOut,
          poolId,
          assetIn: pool.address,
          assetOut: DAI,
          amount: exitAmount,
          userData: '0x',
        },
        { sender: holder.address, recipient: holder.address, fromInternalBalance: false, toInternalBalance: false },
        MAX_UINT256,
        MAX_UINT256
      );

      await setCode(rfsoDAI, getExternalPackageArtifact('linear-pools/MockReaperVault').deployedBytecode);
      const mockLendingPool = await getExternalPackageDeployedAt('linear-pools/MockReaperVault', rfsoDAI);

      await mockLendingPool.setRevertType(2); // Type 2 is malicious swap query revert
      await expect(rebalancer.rebalance(other.address)).to.be.revertedWith('BAL#357'); // MALICIOUS_QUERY_REVERT
    });
  });
});
