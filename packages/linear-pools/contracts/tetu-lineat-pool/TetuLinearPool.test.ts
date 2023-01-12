import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { BigNumber } from 'ethers';

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

async function createTetuTokens({
  deployer,
  lp,
  mainTokenSymbol,
  mainTokenDecimals,
  trader,
  wrappedTokenSymbol,
  wrappedTokenDecimals,
}: {
  deployer: SignerWithAddress;
  lp: SignerWithAddress;
  mainTokenSymbol: string;
  mainTokenDecimals: number;
  trader: SignerWithAddress;
  wrappedTokenSymbol: string;
  wrappedTokenDecimals: number;
}): Promise<{ mainToken: Contract; tetuVault: Contract; tokens: TokenList; wrappedToken: Contract }> {
  const tetuStrategy = await deployPackageContract('MockTetuStrategy');
  const mainToken = await deployToken(mainTokenSymbol, mainTokenDecimals, deployer);
  const tetuVault = await deployPackageContract('MockTetuSmartVault', {
    args: [wrappedTokenSymbol, wrappedTokenSymbol, wrappedTokenDecimals, mainToken.address, tetuStrategy.address],
  });
  const wrappedToken = await getPackageContractDeployedAt('TestToken', tetuVault.address);

  const tokens = new TokenList([mainToken, wrappedToken]).sort();
  await tokens.mint({ to: [lp, trader], amount: fp(100) });

  return { mainToken, tetuVault, tokens, wrappedToken };
}

async function deployTestPool({
  mainTokenAddress,
  ownerAddress,
  poolFactory,
  poolSwapFeePercentage,
  protocolId,
  wrappedTokenAddress,
}: {
  mainTokenAddress: string;
  ownerAddress: string;
  poolFactory: Contract;
  poolSwapFeePercentage: BigNumber;
  protocolId: number;
  wrappedTokenAddress: string;
}): Promise<Contract> {
  const createPoolTransaction = await poolFactory.create(
    'Linear pool',
    'BPT',
    mainTokenAddress,
    wrappedTokenAddress,
    fp(1_000_000),
    poolSwapFeePercentage,
    ownerAddress,
    protocolId
  );

  const receipt = await createPoolTransaction.wait();
  const event = expectEvent.inReceipt(receipt, 'PoolCreated');

  return getPackageContractDeployedAt('LinearPool', event.args.pool);
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

describe('TetuLinearPool', function () {
  let poolFactory: Contract, vault: Contract;
  let deployer: SignerWithAddress, lp: SignerWithAddress, owner: SignerWithAddress, trader: SignerWithAddress;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const TETU_PROTOCOL_ID = 0;

  const BASE_PAUSE_WINDOW_DURATION = MONTH * 3;
  const BASE_BUFFER_PERIOD_DURATION = MONTH;

  before('Setup', async () => {
    // appease the @typescript-eslint/no-unused-vars lint error
    [, lp, owner] = await ethers.getSigners();
    ({ vault, deployer, trader } = await setupEnvironment());

    // Deploy Balancer Queries
    const queriesTask = '20220721-balancer-queries';
    const queriesContract = 'BalancerQueries';
    const queriesArgs = [vault.address];
    const queries = await deployBalancerContract(queriesTask, queriesContract, deployer, queriesArgs);

    // Deploy poolFactory
    poolFactory = await deployPackageContract('TetuLinearPoolFactory', {
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
  });

  describe('constructor', () => {
    it('reverts if the mainToken is not the ASSET of the wrappedToken', async () => {
      const { wrappedToken } = await createTetuTokens({
        deployer,
        lp,
        mainTokenDecimals: 18,
        mainTokenSymbol: 'DAI',
        trader,
        wrappedTokenDecimals: 18,
        wrappedTokenSymbol: 'xDAI',
      });

      const otherToken = await deployToken('USDC', 18, deployer);

      await expect(
        poolFactory.create(
          'Balancer Pool Token',
          'BPT',
          otherToken.address,
          wrappedToken.address,
          bn(0),
          POOL_SWAP_FEE_PERCENTAGE,
          owner.address,
          TETU_PROTOCOL_ID
        )
      ).to.be.revertedWith('BAL#520'); // TOKEN_MISMATCH code
    });
  });

  describe('asset managers', () => {
    let assetManagersPool: Contract;
    let assetManagersTokens: TokenList;

    before('deploy asset managers pool', async () => {
      const { mainToken, tokens, wrappedToken } = await createTetuTokens({
        deployer,
        lp,
        mainTokenDecimals: 18,
        mainTokenSymbol: 'DAI',
        trader,
        wrappedTokenDecimals: 18,
        wrappedTokenSymbol: 'xDAI',
      });
      assetManagersTokens = tokens;

      assetManagersPool = await deployTestPool({
        mainTokenAddress: mainToken.address,
        ownerAddress: owner.address,
        poolFactory,
        poolSwapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
        protocolId: TETU_PROTOCOL_ID,
        wrappedTokenAddress: wrappedToken.address,
      });
    });

    it('sets the same asset manager for main and wrapped token', async () => {
      const poolId = await assetManagersPool.getPoolId();

      const { assetManager: firstAssetManager } = await vault.getPoolTokenInfo(
        poolId,
        assetManagersTokens.first.address
      );
      const { assetManager: secondAssetManager } = await vault.getPoolTokenInfo(
        poolId,
        assetManagersTokens.second.address
      );

      expect(firstAssetManager).to.not.equal(ZERO_ADDRESS);
      expect(firstAssetManager).to.equal(secondAssetManager);
    });

    it('sets the no asset manager for the BPT', async () => {
      const poolId = await assetManagersPool.getPoolId();
      const { assetManager } = await vault.getPoolTokenInfo(poolId, assetManagersPool.address);
      expect(assetManager).to.equal(ZERO_ADDRESS);
    });
  });

  describe('getWrappedTokenRate', () => {
    context('usdc 6 decimals', () => {
      let usdcPool: Contract;
      let usdcTetuVault: Contract;

      before('deploy pool', async () => {
        const { mainToken, tetuVault, wrappedToken } = await createTetuTokens({
          deployer,
          lp,
          mainTokenDecimals: 6,
          mainTokenSymbol: 'USDC',
          trader,
          wrappedTokenDecimals: 6,
          wrappedTokenSymbol: 'xUSDC',
        });
        usdcTetuVault = tetuVault;

        usdcPool = await deployTestPool({
          mainTokenAddress: mainToken.address,
          ownerAddress: owner.address,
          poolFactory,
          poolSwapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
          protocolId: TETU_PROTOCOL_ID,
          wrappedTokenAddress: wrappedToken.address,
        });
      });

      it('should calculate rate correctly', async () => {
        // 1e6 implies a 1:1 exchange rate between main and wrapped token
        await usdcTetuVault.setRate(bn(1e6));
        expect(await usdcPool.getWrappedTokenRate()).to.be.eq(fp(1));

        // We now double the exchange rate to 2:1
        await usdcTetuVault.setRate(bn(2e6));
        expect(await usdcPool.getWrappedTokenRate()).to.be.eq(fp(2));
      });
    });

    context('wbtc 8 decimals', () => {
      let wbtcPool: Contract;
      let wbtcTetuVault: Contract;

      before('deploy pool', async () => {
        const { mainToken, tetuVault, wrappedToken } = await createTetuTokens({
          deployer,
          lp,
          mainTokenDecimals: 8,
          mainTokenSymbol: 'WBTC',
          trader,
          wrappedTokenDecimals: 8,
          wrappedTokenSymbol: 'xWBTC',
        });
        wbtcTetuVault = tetuVault;

        wbtcPool = await deployTestPool({
          mainTokenAddress: mainToken.address,
          ownerAddress: owner.address,
          poolFactory,
          poolSwapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
          protocolId: TETU_PROTOCOL_ID,
          wrappedTokenAddress: wrappedToken.address,
        });
      });

      it('should calculate rate correctly', async () => {
        // 1e8 implies a 1:1 exchange rate between main and wrapped token
        await wbtcTetuVault.setRate(bn(1e8));
        expect(await wbtcPool.getWrappedTokenRate()).to.be.eq(fp(1));

        // We now double the exchange rate to 2:1
        await wbtcTetuVault.setRate(bn(2e8));
        expect(await wbtcPool.getWrappedTokenRate()).to.be.eq(fp(2));
      });
    });

    context('DAI 18 decimals', () => {
      let daiPool: Contract;
      let daiTetuVault: Contract;

      before('deploy pool', async () => {
        const { mainToken, tetuVault, wrappedToken } = await createTetuTokens({
          deployer,
          lp,
          mainTokenDecimals: 18,
          mainTokenSymbol: 'DAI',
          trader,
          wrappedTokenDecimals: 18,
          wrappedTokenSymbol: 'xDAI',
        });
        daiTetuVault = tetuVault;

        daiPool = await deployTestPool({
          mainTokenAddress: mainToken.address,
          ownerAddress: owner.address,
          poolFactory,
          poolSwapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
          protocolId: TETU_PROTOCOL_ID,
          wrappedTokenAddress: wrappedToken.address,
        });
      });

      it('should calculate rate correctly', async () => {
        // 1e8 implies a 1:1 exchange rate between main and wrapped token
        await daiTetuVault.setRate(bn(1e18));
        expect(await daiPool.getWrappedTokenRate()).to.be.eq(fp(1));

        // We now double the exchange rate to 2:1
        await daiTetuVault.setRate(bn(2e18));
        expect(await daiPool.getWrappedTokenRate()).to.be.eq(fp(2));
      });
    });

    context('when Tetu reverts maliciously to impersonate a swap query', () => {
      let maliciousPool: Contract;
      let maliciousTetuVault: Contract;

      before('deploy pool', async () => {
        const { mainToken, tetuVault, wrappedToken } = await createTetuTokens({
          deployer,
          lp,
          mainTokenDecimals: 18,
          mainTokenSymbol: 'DAI',
          trader,
          wrappedTokenDecimals: 18,
          wrappedTokenSymbol: 'xDAI',
        });
        maliciousTetuVault = tetuVault;

        maliciousPool = await deployTestPool({
          mainTokenAddress: mainToken.address,
          ownerAddress: owner.address,
          poolFactory,
          poolSwapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
          protocolId: TETU_PROTOCOL_ID,
          wrappedTokenAddress: wrappedToken.address,
        });
      });

      it('should revert with MALICIOUS_QUERY_REVERT when malicious swap query is detected', async () => {
        await maliciousTetuVault.setRevertType(RevertType.MaliciousSwapQuery);
        await expect(maliciousPool.getWrappedTokenRate()).to.be.revertedWith('BAL#357'); // MALICIOUS_QUERY_REVERT
      });

      it('should revert with MALICIOUS_QUERY_REVERT when malicious join/exit query is detected', async () => {
        await maliciousTetuVault.setRevertType(RevertType.MaliciousJoinExitQuery);
        await expect(maliciousPool.getWrappedTokenRate()).to.be.revertedWith('BAL#357'); // MALICIOUS_QUERY_REVERT
      });
    });
  });

  describe('rebalancing', () => {
    let rebalancingMainToken: Contract;
    let rebalancingPool: Contract;
    let rebalancingTetuVault: Contract;
    let rebalancingTokens: TokenList;

    before('deploy pool', async () => {
      const { mainToken, tetuVault, tokens, wrappedToken } = await createTetuTokens({
        deployer,
        lp,
        mainTokenDecimals: 18,
        mainTokenSymbol: 'DAI',
        trader,
        wrappedTokenDecimals: 18,
        wrappedTokenSymbol: 'xDAI',
      });
      rebalancingMainToken = mainToken;
      rebalancingTetuVault = tetuVault;
      rebalancingTokens = tokens;

      rebalancingPool = await deployTestPool({
        mainTokenAddress: mainToken.address,
        ownerAddress: owner.address,
        poolFactory,
        poolSwapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
        protocolId: TETU_PROTOCOL_ID,
        wrappedTokenAddress: wrappedToken.address,
      });
    });

    context('when Tetu reverts maliciously to impersonate a swap query', () => {
      let rebalancer: Contract;
      before('provide initial liquidity to pool and deploy rebalancer', async () => {
        const poolId = await rebalancingPool.getPoolId();
        await rebalancingTokens.approve({ to: vault, amount: fp(100), from: lp });
        await vault.connect(lp).swap(
          {
            poolId,
            kind: SwapKind.GivenIn,
            assetIn: rebalancingMainToken.address,
            assetOut: rebalancingPool.address,
            amount: fp(10),
            userData: '0x',
          },
          { sender: lp.address, fromInternalBalance: false, recipient: lp.address, toInternalBalance: false },
          0,
          MAX_UINT256
        );

        const { assetManager } = await vault.getPoolTokenInfo(poolId, rebalancingTokens.first.address);
        rebalancer = await getPackageContractDeployedAt('TetuLinearPoolRebalancer', assetManager);
      });

      it('reverts with MALICIOUS_QUERY_REVERT', async () => {
        await rebalancingTetuVault.setRevertType(RevertType.MaliciousSwapQuery);
        await expect(rebalancer.rebalance(trader.address)).to.be.revertedWith('BAL#357'); // MALICIOUS_QUERY_REVERT
      });
    });
  });
});
