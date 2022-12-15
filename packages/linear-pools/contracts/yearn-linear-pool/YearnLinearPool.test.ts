import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import LinearPool from '@balancer-labs/v2-helpers/src/models/pools/linear/LinearPool';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describe('YearnLinearPool', function () {
  let poolFactory: Contract;
  let owner: SignerWithAddress;
  let vault: Vault;

  before('setup', async () => {
    [, , , owner] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy pool factory', async () => {
    vault = await Vault.create();
    const queries = await deploy('v2-standalone-utils/BalancerQueries', { args: [vault.address] });

    poolFactory = await deploy('YearnLinearPoolFactory', {
      args: [vault.address, vault.getFeesProvider().address, queries.address, '1.0', '1.0'],
    });
  });

  async function deployPool(mainTokenAddress: string, wrappedTokenAddress: string) {
    const tx = await poolFactory.create(
      'Linear pool',
      'BPT',
      mainTokenAddress,
      wrappedTokenAddress,
      bn(0),
      fp(0.01),
      owner.address
    );

    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolCreated');

    return LinearPool.deployedAt(event.args.pool);
  }

  describe('asset managers', () => {
    let pool: LinearPool, tokens: TokenList;

    sharedBeforeEach('deploy pool', async () => {
      const token = await Token.create('DAI');
      const tokenVault = await deploy('MockYearnTokenVault', {
        args: ['yvDAI', 'yvDAI', 18, token.address, fp(1)],
      });

      tokens = new TokenList([token, await Token.deployedAt(tokenVault.address)]).sort();
      pool = await deployPool(token.address, tokenVault.address);
    });

    it('sets the same asset manager for main and wrapped token', async () => {
      const poolId = await pool.getPoolId();

      const { assetManager: firstAssetManager } = await vault.getPoolTokenInfo(poolId, tokens.first);
      const { assetManager: secondAssetManager } = await vault.getPoolTokenInfo(poolId, tokens.second);

      expect(firstAssetManager).to.equal(secondAssetManager);
    });

    it('sets the no asset manager for the BPT', async () => {
      const poolId = await pool.getPoolId();
      const { assetManager } = await vault.instance.getPoolTokenInfo(poolId, pool.address);
      expect(assetManager).to.equal(ZERO_ADDRESS);
    });
  });

  describe('getWrappedTokenRate', () => {
    //The yearn vault pricePerShare is a decimal scaled version of getRate
    //for tokens with 6 decimals (USDC), pps is returned as 6 decimals
    //for tokens with 18 decimals (DAI), pps is returned as 18 decimals, etc, etc.
    //We test that under different circumstances, the wrappedTokenRate is always correct
    //and properly scaled to 18 decimals, regardless of token decimals.

    it('should return correct rates for 18 decimal tokens', async () => {
      const token = await Token.create('DAI');
      const tokenVault = await deploy('MockYearnTokenVault', {
        args: ['yvDAI', 'yvDAI', 18, token.address, fp(1)],
      });
      await tokenVault.setTotalSupply(fp(1));

      const pool = await deployPool(token.address, tokenVault.address);

      await tokenVault.setPricePerShare(fp(1.05));
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1.05));

      await tokenVault.setPricePerShare(fp(1.03));
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1.03));

      await tokenVault.setPricePerShare(fp(2.01));
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(2.01));
    });

    it('should return correct rates for 6 decimal tokens', async () => {
      const token = await Token.create({ symbol: 'USDC', decimals: 6 });
      const tokenVault = await deploy('MockYearnTokenVault', {
        args: ['yvUSDC', 'yvUSDC', 6, token.address, 1e6],
      });
      await tokenVault.setTotalSupply(fp(1));

      const pool = await deployPool(token.address, tokenVault.address);

      await tokenVault.setPricePerShare(1.05e6);
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1.05));

      await tokenVault.setPricePerShare(1.03e6);
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1.03));

      await tokenVault.setPricePerShare(2.01e6);
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(2.01));
    });

    it('should return correct rates for 8 decimal tokens', async () => {
      const token = await Token.create({ symbol: 'wBTC', decimals: 8 });
      const tokenVault = await deploy('MockYearnTokenVault', {
        args: ['yvBTC', 'yvBTC', 8, token.address, 1e8],
      });
      await tokenVault.setTotalSupply(fp(1));

      const pool = await deployPool(token.address, tokenVault.address);

      await tokenVault.setPricePerShare(1.05e8);
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1.05));

      await tokenVault.setPricePerShare(1.03e8);
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1.03));

      await tokenVault.setPricePerShare(2.01e8);
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(2.01));
    });

    it('should return correct rates for 2 decimal tokens', async () => {
      const token = await Token.create({ symbol: 'TOKEN', decimals: 2 });
      const tokenVault = await deploy('MockYearnTokenVault', {
        args: ['TOKEN', 'TOKEN', 2, token.address, 1e2],
      });
      await tokenVault.setTotalSupply(fp(1));

      const pool = await deployPool(token.address, tokenVault.address);

      await tokenVault.setPricePerShare(1.05e2);
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1.05));

      await tokenVault.setPricePerShare(1.03e2);
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1.03));

      await tokenVault.setPricePerShare(2.01e2);
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(2.01));
    });
  });
});
