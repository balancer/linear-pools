import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { bn, fp } from '@orbcollective/shared-dependencies/numbers';
import {
  deployPackageContract,
  getPackageContractDeployedAt,
  deployToken,
  setupEnvironment,
  getBalancerContractArtifact,
  MAX_UINT256,
  ZERO_ADDRESS,
} from '@orbcollective/shared-dependencies';

import { MONTH } from '@orbcollective/shared-dependencies/time';

import * as expectEvent from '@orbcollective/shared-dependencies/expectEvent';
import TokenList from '@orbcollective/shared-dependencies/test-helpers/token/TokenList';

export enum SwapKind {
  GivenIn = 0,
  GivenOut,
}

enum RevertType {
  DoNotRevert,
  NonMalicious,
  MaliciousSwapQuery,
  MaliciousJoinExitQuery,
}

async function deployBalancerContract(
  task: string,
  contractName: string,
  deployer: SignerWithAddress,
  args: unknown[]
): Promise<Contract> {
  const artifact = await getBalancerContractArtifact(task, contractName);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const contract = await factory.deploy(...args);

  return contract;
}

describe('ReaperLinearPool', function () {
  let pool: Contract;
  let vault: Contract;
  let tokens: TokenList;
  let mainToken: Contract, wrappedToken: Contract;
  let poolFactory: Contract;
  let mockReaperVault: Contract;
  let guardian: SignerWithAddress, lp: SignerWithAddress, owner: SignerWithAddress;
  let manager: SignerWithAddress;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const REAPER_PROTOCOL_ID = 1;

  const BASE_PAUSE_WINDOW_DURATION = MONTH * 3;
  const BASE_BUFFER_PERIOD_DURATION = MONTH;

  before('Setup', async () => {
    let deployer: SignerWithAddress;
    let trader: SignerWithAddress;

    // appease the @typescript-eslint/no-unused-vars lint error
    [, lp, owner] = await ethers.getSigners();
    ({ vault, deployer, trader } = await setupEnvironment());
    manager = deployer;
    guardian = trader;

    // Deploy tokens
    mainToken = await deployToken('DAI', 18, deployer);
    mockReaperVault = await deployPackageContract('MockReaperVault', {
      args: ['rfDAI', 'rfDAI', 18, mainToken.address, fp(1)],
    });
    wrappedToken = await getPackageContractDeployedAt('TestToken', mockReaperVault.address);

    tokens = new TokenList([mainToken, wrappedToken]).sort();
    await tokens.mint({ to: [lp, trader], amount: fp(100) });

    // Deploy Balancer Queries
    const queriesTask = '20220721-balancer-queries';
    const queriesContract = 'BalancerQueries';
    const queriesArgs = [vault.address];
    const queries = await deployBalancerContract(queriesTask, queriesContract, manager, queriesArgs);

    // Deploy poolFactory
    poolFactory = await deployPackageContract('ReaperLinearPoolFactory', {
      args: [
        vault.address,
        ZERO_ADDRESS,
        queries.address,
        'factoryVersion',
        'poolVersion',
        BASE_PAUSE_WINDOW_DURATION,
        BASE_BUFFER_PERIOD_DURATION,
      ],
    });

    // Deploy and initialize pool
    const tx = await poolFactory.create(
      'Balancer Pool Token',
      'BPT',
      mainToken.address,
      wrappedToken.address,
      bn(0),
      POOL_SWAP_FEE_PERCENTAGE,
      owner.address,
      REAPER_PROTOCOL_ID
    );
    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolCreated');

    pool = await getPackageContractDeployedAt('LinearPool', event.args.pool);
  });

  describe('constructor', () => {
    it('reverts if the mainToken is not the ASSET of the wrappedToken', async () => {
      const otherToken = await deployToken('USDC', 6, manager);

      await expect(
        poolFactory.create(
          'Balancer Pool Token',
          'BPT',
          otherToken.address,
          wrappedToken.address,
          bn(0),
          POOL_SWAP_FEE_PERCENTAGE,
          owner.address,
          REAPER_PROTOCOL_ID
        )
      ).to.be.revertedWith('BAL#520'); // TOKEN_MISMATCH code
    });
  });

  describe('asset managers', () => {
    it('sets the same asset manager for main and wrapped token', async () => {
      const poolId = await pool.getPoolId();

      const { assetManager: firstAssetManager } = await vault.getPoolTokenInfo(poolId, tokens.first.address);
      const { assetManager: secondAssetManager } = await vault.getPoolTokenInfo(poolId, tokens.second.address);

      expect(firstAssetManager).to.not.equal(ZERO_ADDRESS);
      expect(firstAssetManager).to.equal(secondAssetManager);
    });

    it('sets the no asset manager for the BPT', async () => {
      const poolId = await pool.getPoolId();
      const { assetManager } = await vault.getPoolTokenInfo(poolId, pool.address);
      expect(assetManager).to.equal(ZERO_ADDRESS);
    });
  });

  describe('getWrappedTokenRate', () => {
    context('with a balance of 200 and a total supply of 200', () => {
      it('returns the expected value', async () => {
        // Set the total supply for rpDAI to get the exchange rate
        await mockReaperVault.setBalance(fp(200)); 
        expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1));
      });
    });

    context('with a balance of 100 and a total supply of 200', () => {
      it('returns the expected value', async () => {
        // Set the total supply for rpDAI to get the exchange rate
        await mockReaperVault.setBalance(fp(100));        
        expect(await pool.getWrappedTokenRate()).to.be.eq(fp(0.5));
      });
    });

    context('when Reaper reverts maliciously to impersonate a swap query', () => {
      it('reverts with MALICIOUS_QUERY_REVERT', async () => {
        await mockReaperVault.setRevertType(RevertType.MaliciousSwapQuery);
        await expect(pool.getWrappedTokenRate()).to.be.revertedWith('BAL#357'); // MALICIOUS_QUERY_REVERT
      });
    });

    context('when Reaper reverts maliciously to impersonate a join/exit query', () => {
      it('reverts with MALICIOUS_QUERY_REVERT', async () => {
        await mockReaperVault.setRevertType(RevertType.MaliciousJoinExitQuery);
        await expect(pool.getWrappedTokenRate()).to.be.revertedWith('BAL#357'); // MALICIOUS_QUERY_REVERT
      });
    });
  });

  describe('rebalancing', () => {
    context('when Reaper reverts maliciously to impersonate a swap query', () => {
      let rebalancer: Contract;
      beforeEach('provide initial liquidity to pool', async () => {
        await mockReaperVault.setRevertType(RevertType.DoNotRevert);
        const poolId = await pool.getPoolId();
        await tokens.approve({ to: vault, amount: fp(100), from: lp });
        await vault.connect(lp).swap(
          {
            poolId,
            kind: SwapKind.GivenIn,
            assetIn: mainToken.address,
            assetOut: pool.address,
            amount: fp(10),
            userData: '0x',
          },
          { sender: lp.address, fromInternalBalance: false, recipient: lp.address, toInternalBalance: false },
          0,
          MAX_UINT256
        );
      });

      beforeEach('deploy and initialize pool', async () => {
        const poolId = await pool.getPoolId();
        const { assetManager } = await vault.getPoolTokenInfo(poolId, tokens.first.address);
        rebalancer = await getPackageContractDeployedAt('ReaperLinearPoolRebalancer', assetManager);
      });

      beforeEach('make Reaper lending pool start reverting', async () => {
        await mockReaperVault.setRevertType(RevertType.MaliciousSwapQuery);
      });

      it('reverts with MALICIOUS_QUERY_REVERT', async () => {
        await expect(rebalancer.rebalance(guardian.address)).to.be.revertedWith('BAL#357'); // MALICIOUS_QUERY_REVERT
      });
    });
  });
});