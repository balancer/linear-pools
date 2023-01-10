import path from 'path';
import { Dictionary, fromPairs } from 'lodash';

import { ethers } from 'hardhat';
import { Artifact } from 'hardhat/types';
import { Artifacts } from 'hardhat/internal/artifacts';

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { JsonFragment } from '@ethersproject/abi';
import { BigNumber } from '@ethersproject/bignumber';
import { MaxUint256 } from '@ethersproject/constants';
import { Contract, ContractReceipt, ContractTransaction } from '@ethersproject/contracts';

import { MONTH } from './time';
import { maxUint } from './numbers';

import { getBalancerContractAbi, getBalancerContractBytecode } from '@balancer-labs/v2-deployments';

import MockTimelockAuthorizerArtifact from './artifacts/contracts/MockTimelockAuthorizer.sol/MockTimelockAuthorizer.json';
import TestTokenArtifact from './artifacts/contracts/TestToken.sol/TestToken.json';
import TestWETHArtifact from './artifacts/contracts/TestWETH.sol/TestWETH.json';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';

export const MAX_UINT112: BigNumber = maxUint(112);
export const MAX_UINT256: BigNumber = maxUint(256);

export type TokenList = Dictionary<Contract>;

export const tokenSymbols = Array.from({ length: 100 }, (_, i) => `TKN${i}`);

export async function getSigners(): Promise<{
  deployer: SignerWithAddress;
  admin: SignerWithAddress;
  creator: SignerWithAddress;
  liquidityProvider: SignerWithAddress;
  trader: SignerWithAddress;
}> {
  const [deployer, admin, creator, liquidityProvider, trader] = await ethers.getSigners();

  return { deployer, admin, creator, liquidityProvider, trader };
}

export async function txConfirmation(tx: ContractTransaction | Promise<ContractTransaction>): Promise<ContractReceipt> {
  return (await tx).wait();
}

export const getBalancerContractArtifact = async (
  task: string,
  contract: string
): Promise<{ bytecode: string; abi: JsonFragment[] }> => {
  const abi = getBalancerContractAbi(task, contract) as Promise<JsonFragment[]>;
  const bytecode = getBalancerContractBytecode(task, contract);

  return { abi: await abi, bytecode: await bytecode };
};

export async function deployVault(): Promise<{
  authorizer: Contract;
  vault: Contract;
}> {
  const [deployer] = await ethers.getSigners();
  const weth = await deployWETH(deployer);

  const authorizerFactory = new ethers.ContractFactory(
    MockTimelockAuthorizerArtifact.abi,
    MockTimelockAuthorizerArtifact.bytecode,
    deployer
  );
  const authorizer = (await authorizerFactory.deploy()) as unknown as Contract;

  const vaultArtifact = await getBalancerContractArtifact('20210418-vault', 'Vault');
  const vaultFactory = new ethers.ContractFactory(vaultArtifact.abi, vaultArtifact.bytecode, deployer);
  const vault = (await vaultFactory.deploy(authorizer.address, weth.address, 0, 0)) as unknown as Contract;

  return {
    authorizer,
    vault,
  };
}

export async function setupEnvironment(): Promise<{
  authorizer: Contract;
  vault: Contract;
  deployer: SignerWithAddress;
  liquidityProvider: SignerWithAddress;
  trader: SignerWithAddress;
}> {
  const { deployer, liquidityProvider, trader } = await getSigners();
  const { authorizer, vault } = await deployVault();

  return { authorizer, vault, deployer, liquidityProvider, trader };
}

export async function deploySortedTokens(
  symbols: Array<string>,
  decimals: Array<number>,
  from?: SignerWithAddress
): Promise<TokenList> {
  const [defaultDeployer] = await ethers.getSigners();
  const deployer = from || defaultDeployer;
  return fromPairs(
    (await Promise.all(symbols.map((_, i) => deployToken(`T${i}`, decimals[i], deployer))))
      .sort((tokenA, tokenB) => (tokenA.address.toLowerCase() > tokenB.address.toLowerCase() ? 1 : -1))
      .map((token, index) => [symbols[index], token])
  );
}

export async function deployWETH(from?: SignerWithAddress): Promise<Contract> {
  const [defaultDeployer] = await ethers.getSigners();
  const deployer = from || defaultDeployer;
  const factory = new ethers.ContractFactory(TestWETHArtifact.abi, TestWETHArtifact.bytecode, deployer);
  const instance = await factory.deploy(deployer.address);
  return instance;
}

export async function deployToken(symbol: string, decimals?: number, from?: SignerWithAddress): Promise<Contract> {
  const [defaultDeployer] = await ethers.getSigners();
  const deployer = from || defaultDeployer;
  const factory = new ethers.ContractFactory(TestTokenArtifact.abi, TestTokenArtifact.bytecode, deployer);
  const instance = await factory.deploy(symbol, symbol, decimals);
  return instance;
}

export async function mintTokens(
  tokens: TokenList,
  symbol: string,
  recipient: SignerWithAddress | string,
  amount: number | BigNumber | string
): Promise<void> {
  await tokens[symbol].mint(typeof recipient == 'string' ? recipient : recipient.address, amount.toString());
}

export function printGas(gas: number | BigNumber): string {
  if (typeof gas !== 'number') {
    gas = gas.toNumber();
  }

  return `${(gas / 1000).toFixed(1)}k`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ContractDeploymentParams = {
  from?: SignerWithAddress;
  args?: Array<unknown>;
  libraries?: Dictionary<string>;
};

export async function getPackageContractDeployedAt(contract: string, address: string): Promise<Contract> {
  const artifact = getPackageArtifact(contract);
  return ethers.getContractAt(artifact.abi, address);
}

export async function deployPackageContract(
  contract: string,
  { from, args, libraries }: ContractDeploymentParams = {}
): Promise<Contract> {
  if (!args) args = [];
  if (!from) from = (await ethers.getSigners())[0];

  const artifact = getPackageArtifact(contract);

  const factory = await ethers.getContractFactoryFromArtifact(artifact, { signer: from, libraries });
  const instance = await factory.deploy(...args);

  return instance.deployed();
}

function getPackageArtifact(contract: string): Artifact {
  const artifactsPath = path.resolve('./artifacts');
  const artifacts = new Artifacts(artifactsPath);
  return artifacts.readArtifactSync(contract.split('/').slice(-1)[0]);
}

export async function getExternalPackageDeployedAt(contract: string, address: string): Promise<Contract> {
  const artifact = getExternalPackageArtifact(contract);
  return ethers.getContractAt(artifact.abi, address) as unknown as Contract;
}

export function getExternalPackageArtifact(contract: string): Artifact {
  let artifactsPath: string;
  if (!contract.includes('/')) {
    artifactsPath = path.resolve('./artifacts');
  } else {
    const packageName = `@orbcollective/${contract.split('/')[0]}`;
    const packagePath = path.dirname(require.resolve(`${packageName}/package.json`));
    artifactsPath = `${packagePath}/artifacts`;
  }

  const artifacts = new Artifacts(artifactsPath);
  return artifacts.readArtifactSync(contract.split('/').slice(-1)[0]);
}
