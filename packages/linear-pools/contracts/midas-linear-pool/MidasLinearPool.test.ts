import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
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

import { FundManagement, SingleSwap } from '@balancer-labs/balancer-js';

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

describe('MidasLinearPool', function () {
  let pool: Contract;
  let vault: Contract;
  let tokens: TokenList;
  let mainToken: Contract, wrappedToken: Contract, wrappedTokenInstance: Contract;
  let poolFactory: Contract;
  let guardian: SignerWithAddress, lp: SignerWithAddress, owner: SignerWithAddress;
  let manager: SignerWithAddress;
  let funds: FundManagement;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const MIDAS_PROTOCOL_ID = 0;

  const BASE_PAUSE_WINDOW_DURATION = MONTH * 3;
  const BASE_BUFFER_PERIOD_DURATION = MONTH;

  before('setup', async () => {
    let deployer: SignerWithAddress;
    let trader: SignerWithAddress;

    // appease the @typescript-eslint/no-unused-vars lint error
    [, lp, owner] = await ethers.getSigners();
    ({ vault, deployer, trader } = await setupEnvironment());
    manager = deployer;
    guardian = trader;

    funds = {
      sender: lp.address,
      fromInternalBalance: false,
      toInternalBalance: false,
      recipient: lp.address,
    };

    // Deploy tokens
    mainToken = await deployToken('USDC', 18, deployer);
    wrappedTokenInstance = await deployPackageContract('MockCToken', {
      args: ['cDAI,', 'cDAI', 18, mainToken.address, fp(1.05)],
    });

    wrappedToken = await getPackageContractDeployedAt('TestToken', wrappedTokenInstance.address);

    tokens = new TokenList([mainToken, wrappedToken]).sort();

    await tokens.mint({ to: [lp, trader], amount: fp(100) });

    // Deploy Balancer Queries
    const queriesTask = '20220721-balancer-queries';
    const queriesContract = 'BalancerQueries';
    const queriesArgs = [vault.address];
    const queries = await deployBalancerContract(queriesTask, queriesContract, manager, queriesArgs);

    // Deploy poolFactory
    poolFactory = await deployPackageContract('MidasLinearPoolFactory', {
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
      MIDAS_PROTOCOL_ID
    );
    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolCreated');

    pool = await getPackageContractDeployedAt('LinearPool', event.args.pool);
  });

  describe('constructor', () => {
    it('reverts if the mainToken is not the ASSET of the wrappedToken', async () => {
      const otherToken = await deployToken('USDC', 18, manager);

      await expect(
        poolFactory.create(
          'Balancer Pool Token',
          'BPT',
          otherToken.address,
          wrappedToken.address,
          bn(0),
          POOL_SWAP_FEE_PERCENTAGE,
          owner.address,
          MIDAS_PROTOCOL_ID
        )
      ).to.be.revertedWith('BAL#520');
    });
  });

  describe('asset managers', () => {
    it('sets the same asset manager for main and wrapped token', async () => {
      const poolId = await pool.getPoolId();

      const { assetManager: firstAssetManager } = await vault.getPoolTokenInfo(poolId, tokens.first.address);
      const { assetManager: secondAssetManager } = await vault.getPoolTokenInfo(poolId, tokens.second.address);

      expect(firstAssetManager).to.not.equal(ZERO_ADDRESS);
      expect(secondAssetManager).to.equal(firstAssetManager);
    });

    it('sets the no asset manager for the BPT', async () => {
      const poolId = await pool.getPoolId();
      const { assetManager } = await vault.getPoolTokenInfo(poolId, pool.address);
      expect(assetManager).to.equal(ZERO_ADDRESS);
    });
  });

  describe('getWrappedTokenRate', () => {
    context('under normal operation', () => {
      it('returns the expected value', async () => {
        expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1.05));

        // change exchangeRate at the mockCToken
        await wrappedTokenInstance.setExchangeRate(bn(2e18));
        expect(await pool.getWrappedTokenRate()).to.be.eq(bn(2e18));

        // change exchangeRate at the mockCToken
        await wrappedTokenInstance.setExchangeRate(bn(1e18));
        expect(await pool.getWrappedTokenRate()).to.be.eq(bn(1e18));
      });
    });

    context('when Midas reverts maliciously to impersonate a swap query', () => {
      it('reverts with MALICIOUS_QUERY_REVERT', async () => {
        await wrappedTokenInstance.setRevertType(RevertType.MaliciousSwapQuery);
        await expect(pool.getWrappedTokenRate()).to.be.revertedWith('BAL#357');
      });
    });

    context('when Midas reverts maliciously to impersonate a join/exit query', () => {
      it('reverts with MALICIOUS_QUERY_REVERT', async () => {
        await wrappedTokenInstance.setRevertType(RevertType.MaliciousJoinExitQuery);
        await expect(pool.getWrappedTokenRate()).to.be.revertedWith('BAL#357');
      });
    });
  });

  describe('rebalancing', () => {
    context('when Midas reverts maliciously to impersonate a swap query', () => {
      let rebalancer: Contract;
      beforeEach('provide initial liquidity to pool', async () => {
        await wrappedTokenInstance.setRevertType(RevertType.DoNotRevert);
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
        rebalancer = await getPackageContractDeployedAt('MidasLinearPoolRebalancer', assetManager);
      });

      beforeEach('make Midas lending pool start reverting', async () => {
        await wrappedTokenInstance.setRevertType(RevertType.MaliciousSwapQuery);
      });

      it('reverts with MALICIOUS_QUERY_REVERT', async () => {
        await expect(rebalancer.rebalance(guardian.address)).to.be.revertedWith('BAL#357'); // MALICIOUS_QUERY_REVERT
      });
    });
  });

  // Midas custom tests
  describe('usdc vault with 6 decimals tests', () => {
    let deployer: SignerWithAddress;
    let usdc: Contract;
    let cusdc: Contract;
    let bbcusdc: Contract;

    let initialExchangeRate: BigNumber;
    let usdcRequired: BigNumber;

    beforeEach('setup tokens, cToken and linear pool', async () => {
      usdc = await deployToken('USDC', 6, deployer);
      cusdc = await deployPackageContract('MockCToken', {
        args: ['cUSDC', 'cUSDC', 6, usdc.address, fp(1)],
      });

      const tx = await poolFactory.create(
        'usdc cusdc Linear Pool',
        'BPT',
        usdc.address,
        cusdc.address,
        fp(1_000_000),
        POOL_SWAP_FEE_PERCENTAGE,
        owner.address,
        MIDAS_PROTOCOL_ID
      );
      const receipt = await tx.wait();
      const event = expectEvent.inReceipt(receipt, 'PoolCreated');

      bbcusdc = await getPackageContractDeployedAt('LinearPool', event.args.pool);

      const initialJoinAmount = bn(100000000000);
      await usdc.mint(lp.address, initialJoinAmount);

      await usdc.connect(lp).approve(vault.address, initialJoinAmount);

      const joinData: SingleSwap = {
        poolId: await bbcusdc.getPoolId(),
        kind: 0,
        assetIn: usdc.address,
        assetOut: bbcusdc.address,
        amount: BigNumber.from(100_000e6),
        userData: '0x',
      };

      const transaction = await vault.connect(lp).swap(joinData, funds, BigNumber.from(0), MAX_UINT256);
      await transaction.wait();
    });

    it('should return wrapped token rate scaled to 18 decimals for a 6 decimal token', async () => {
      console.log('test');
      await cusdc.setExchangeRate(fp(1.5));
      expect(await bbcusdc.getWrappedTokenRate()).to.be.eq(fp(1.5));
    });

    it('should swap 0.800_000 cUSDC to 1 USDC when the exchangeRate is 1.25e18', async () => {
      initialExchangeRate = fp(1.25);
      const cUsdcAmount = bn(8e5);
      await cusdc.setExchangeRate(initialExchangeRate);
      expect(await bbcusdc.getWrappedTokenRate()).to.be.eq(fp(1.25));

      usdcRequired = cUsdcAmount.mul(initialExchangeRate).div(BigNumber.from(10).pow(18));
      await usdc.connect(lp).mint(lp.address, usdcRequired);
      await usdc.connect(lp).approve(cusdc.address, usdcRequired);

      await cusdc.connect(lp).mintCTokens(usdcRequired);
      await cusdc.connect(lp).approve(vault.address, MAX_UINT256);

      const rebalanceSwapData: SingleSwap = {
        poolId: await bbcusdc.getPoolId(),
        kind: 0,
        assetIn: cusdc.address,
        assetOut: usdc.address,
        amount: cUsdcAmount,
        userData: '0x',
      };

      const balanceBefore = await usdc.balanceOf(lp.address);
      await vault.connect(lp).swap(rebalanceSwapData, funds, BigNumber.from(0), MAX_UINT256);
      const balanceAfter = await usdc.balanceOf(lp.address);
      const amountReturned = balanceAfter.sub(balanceBefore);

      expect(amountReturned).to.be.eq(bn(1e6));
    });

    it('should swap 800 cUSDC to 1,000 USDC when the ppfs is 1.25e18', async () => {
      initialExchangeRate = fp(1.25);
      // we try to rebalance it with some wrapped tokens
      const cUsdcAmount = bn(8e8);
      await cusdc.setExchangeRate(initialExchangeRate);

      expect(await bbcusdc.getWrappedTokenRate()).to.be.eq(initialExchangeRate);

      usdcRequired = cUsdcAmount.mul(initialExchangeRate).div(BigNumber.from(10).pow(18));

      await usdc.connect(lp).mint(lp.address, usdcRequired);
      await usdc.connect(lp).approve(cusdc.address, usdcRequired);

      await cusdc.connect(lp).mintCTokens(usdcRequired);
      await cusdc.connect(lp).approve(vault.address, MAX_UINT256);

      const rebalanceSwapData: SingleSwap = {
        poolId: await bbcusdc.getPoolId(),
        kind: 0,
        assetIn: cusdc.address,
        assetOut: usdc.address,
        amount: cUsdcAmount,
        userData: '0x',
      };

      const balanceBefore = await usdc.balanceOf(lp.address);

      await vault.connect(lp).swap(rebalanceSwapData, funds, BigNumber.from(0), MAX_UINT256);
      const balanceAfter = await usdc.balanceOf(lp.address);
      const amountReturned = balanceAfter.sub(balanceBefore);
      expect(amountReturned).to.be.eq(1e9);
    });
  });

  describe('DAI with 18 decimals tests', () => {
    let deployer: SignerWithAddress;

    let dai: Contract;
    let cdai: Contract;
    let bbcdai: Contract;

    let initialExchangeRate: BigNumber;
    let daiRequired: BigNumber;

    beforeEach('setup tokens, cToken and linear pool', async () => {
      dai = await deployToken('DAI', 18, deployer);
      cdai = await deployPackageContract('MockCToken', {
        args: ['cdai', 'cdai', 18, dai.address, fp(1)],
      });

      const tx = await poolFactory.create(
        'dai cdai Linear Pool',
        'BPT',
        dai.address,
        cdai.address,
        fp(1_000_000),
        POOL_SWAP_FEE_PERCENTAGE,
        owner.address,
        MIDAS_PROTOCOL_ID
      );

      const receipt = await tx.wait();
      const event = expectEvent.inReceipt(receipt, 'PoolCreated');

      bbcdai = await getPackageContractDeployedAt('LinearPool', event.args.pool);
      const initialJoinAmount = fp(100);
      await dai.mint(lp.address, initialJoinAmount);
      await dai.connect(lp).approve(vault.address, initialJoinAmount);

      const joinData: SingleSwap = {
        poolId: await bbcdai.getPoolId(),
        kind: 0,
        assetIn: dai.address,
        assetOut: bbcdai.address,
        amount: initialJoinAmount,
        userData: '0x',
      };

      const transaction = await vault.connect(lp).swap(joinData, funds, BigNumber.from(0), MAX_UINT256);
      await transaction.wait();
    });

    it('should return unscaled wrapped token rate for an 18 decimal token', async () => {
      await cdai.setExchangeRate(fp(1.5));
      expect(await bbcdai.getWrappedTokenRate()).to.be.eq(fp(1.5));
    });

    it('should swap 1 cDAI to 2 DAI when the pricePerFullShare is 2e18', async () => {
      initialExchangeRate = fp(2);
      await cdai.setExchangeRate(initialExchangeRate);
      expect(await bbcdai.getWrappedTokenRate()).to.be.eq(fp(2));

      const cDAIAmount = fp(1);
      daiRequired = cDAIAmount.mul(initialExchangeRate).div(BigNumber.from(10).pow(18));
      await dai.connect(lp).mint(lp.address, daiRequired);
      await dai.connect(lp).approve(cdai.address, daiRequired);

      await cdai.connect(lp).mintCTokens(daiRequired);
      await cdai.connect(lp).approve(vault.address, MAX_UINT256);

      expect(await cdai.balanceOf(lp.address)).to.be.eq(cDAIAmount);

      const data: SingleSwap = {
        poolId: await bbcdai.getPoolId(),
        kind: 0,
        assetIn: cdai.address,
        assetOut: dai.address,
        amount: cDAIAmount,
        userData: '0x',
      };

      const balanceBefore = await dai.balanceOf(lp.address);
      await vault.connect(lp).swap(data, funds, BigNumber.from(0), MAX_UINT256);
      const balanceAfter = await dai.balanceOf(lp.address);
      const amountReturned = balanceAfter.sub(balanceBefore);
      expect(amountReturned).to.be.eq(fp(2));
    });
  });
});
