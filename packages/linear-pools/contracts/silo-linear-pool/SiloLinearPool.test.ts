import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { bn, fp, FP_ONE } from '@orbcollective/shared-dependencies/numbers';
import {
  deployPackageContract,
  getPackageContractDeployedAt,
  deployToken,
  setupEnvironment,
  getBalancerContractArtifact,
  MAX_UINT256,
  ZERO_ADDRESS,
} from '@orbcollective/shared-dependencies';

import { currentTimestamp, MONTH } from '@orbcollective/shared-dependencies/time';

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

enum AssetStatus {
  Undefined,
  Active,
  Removed,
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

describe('SiloLinearPool', function () {
  let pool: Contract,
    vault: Contract,
    tokens: TokenList,
    mainToken: Contract,
    mockRepository: Contract,
    mockSilo: Contract,
    wrappedToken: Contract;
  let poolFactory: Contract;
  let wrappedTokenInstance: Contract;
  let trader: SignerWithAddress;
  let guardian: SignerWithAddress, lp: SignerWithAddress, owner: SignerWithAddress;
  let manager: SignerWithAddress;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const SILO_PROTOCOL_ID = 4;

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
    mainToken = await deployToken('USDC', 6, deployer);

    // Deploy the mock repository
    mockRepository = await deployPackageContract('MockSiloRepository', {});
    // Deploy the Silo (Liquidity Pool)
    mockSilo = await deployPackageContract('MockSilo', {
      args: [mockRepository.address, mainToken.address],
    });

    const wrappedTokenInstance = await deployPackageContract('MockShareToken', {
      args: ['sUSDC', 'sUSDC', mockSilo.address, mainToken.address, 6],
    });

    wrappedToken = await getPackageContractDeployedAt('TestToken', wrappedTokenInstance.address);

    tokens = new TokenList([mainToken, wrappedToken]).sort();

    await tokens.mint({ to: [lp, trader], amount: fp(100) });

    await wrappedTokenInstance.setTotalSupply(fp(10000));
    // initalize the asset storage mapping within the Silo for the main token
    await mockSilo.setAssetStorage(
      mainToken.address, // interestBarringAsset
      wrappedToken.address, // CollateralToken
      wrappedToken.address, // CollateralOnlyToken (using wrapped token as a placeholder)
      wrappedToken.address, // debtToken (using wrapped token as a placeholder)
      fp(20000), // totalDeposits
      fp(100), // collateralOnlyDeposits
      fp(9000) // totalBorrowAmount
    );

    await mockSilo.setInterestData(
      mainToken.address, // interestBarringAsset
      0, // harvestedProtocolFees
      0, // protocolFees
      0, // interestRateTimestamp
      AssetStatus.Active // status
    );

    // Deploy Balancer Queries
    const queriesTask = '20220721-balancer-queries';
    const queriesContract = 'BalancerQueries';
    const queriesArgs = [vault.address];
    const queries = await deployBalancerContract(queriesTask, queriesContract, manager, queriesArgs);

    // Deploy poolFactory
    poolFactory = await deployPackageContract('SiloLinearPoolFactory', {
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
      SILO_PROTOCOL_ID
    );
    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolCreated');

    pool = await getPackageContractDeployedAt('LinearPool', event.args.pool);
  });

  describe('constructor', () => {
    it('do not revert if the mainToken is not the ASSET of the wrappedToken', async () => {
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
          SILO_PROTOCOL_ID
        )
      ).to.be.ok;
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
    context('under normal operation', () => {
      it('returns the expected value', async () => {
        // Calculate the expected rate and compare to the getWrappedToken return value
        const assetStorage = await mockSilo.assetStorage(mainToken.address);
        // Get the 4th member from the struct 'total deposits'
        const totalAmount = assetStorage[3];

        const totalShares: number = await wrappedToken.totalSupply();

        const expectedRate: number = totalAmount / totalShares;

        expect(await pool.getWrappedTokenRate()).to.equal(fp(expectedRate));
      });
    });

    context('when Silo reverts maliciously to impersonate a swap query', () => {
      it('reverts with MALICIOUS_QUERY_REVERT', async () => {
        await mockSilo.setRevertType(RevertType.MaliciousSwapQuery);
        await expect(pool.getWrappedTokenRate()).to.be.revertedWith('BAL#357'); // MALICIOUS_QUERY_REVERT
      });
    });

    context('when Silo reverts maliciously to impersonate a join/exit query', () => {
      it('reverts with MALICIOUS_QUERY_REVERT', async () => {
        await mockSilo.setRevertType(RevertType.MaliciousJoinExitQuery);
        await expect(pool.getWrappedTokenRate()).to.be.revertedWith('BAL#357'); // MALICIOUS_QUERY_REVERT
      });
    });
  });

  describe('rebalancing', () => {
    context('when Silo reverts maliciously to impersonate a swap query', () => {
      let rebalancer: Contract;
      beforeEach('provide initial liquidity to pool', async () => {
        await mockSilo.setRevertType(RevertType.DoNotRevert);
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
        rebalancer = await getPackageContractDeployedAt('SiloLinearPoolRebalancer', assetManager);
      });

      beforeEach('make Silo lending pool start reverting', async () => {
        await mockSilo.setRevertType(RevertType.MaliciousSwapQuery);
      });

      it('reverts with MALICIOUS_QUERY_REVERT', async () => {
        await expect(rebalancer.rebalance(guardian.address)).to.be.revertedWith('BAL#357'); // MALICIOUS_QUERY_REVERT
      });
    });
  });
});
