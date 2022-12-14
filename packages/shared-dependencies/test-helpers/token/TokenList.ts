import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { ZERO_ADDRESS } from '../../index';
import { RawTokenApproval, RawTokenMint, TokenApproval, TokenMint } from './types';

export const ETH_TOKEN_ADDRESS = ZERO_ADDRESS;

interface Token {
  address: string;
  approve: (to: string, amount: number, options?: { from?: unknown }) => Promise<void>;
  connect: (address: SignerWithAddress | undefined) => Promise<Token>;
  mint: (to: string, amount: number, options?: { from?: unknown }) => Promise<void>;
  symbol: () => Promise<string>;
}

export default class TokenList {
  tokens: Token[];

  constructor(tokens: Token[] = []) {
    this.tokens = tokens;
  }

  get first(): Token {
    return this.get(0);
  }

  get second(): Token {
    return this.get(1);
  }

  get(index: number | Token): Token {
    if (typeof index !== 'number') return index;
    if (index >= this.tokens.length) throw Error('Accessing invalid token list index');
    return this.tokens[index];
  }

  async getTokenBySymbol(symbol: string): Promise<Token> {
    const symbols = await Promise.all(this.tokens.map(async (token) => await token.symbol()));
    const symbolIndex = symbols.indexOf(symbol);
    return this.tokens[symbolIndex];
  }

  async mint(rawParams: RawTokenMint): Promise<void> {
    const toTokenMints = (params: RawTokenMint): TokenMint[] => {
      if (Array.isArray(params)) return params.flatMap(toTokenMints);

      const { to, amount, from } = params;

      if (!Array.isArray(to)) {
        if (Array.isArray(from)) throw Error('Inconsistent mint sender length');
        return [{ to, amount, from }];
      }

      if (Array.isArray(from) && to.length !== from.length) throw Error('Inconsistent mint sender length');
      return to.map((to, i) => ({ to, amount, from: Array.isArray(from) ? from[i] : from }));
    };

    const params: TokenMint[] = toTokenMints(rawParams);
    await Promise.all(
      params.flatMap(({ to, amount }) =>
        this.tokens.map((token) => {
          return token.mint(to.address, amount);
        })
      )
    );
  }

  async approve(rawParams: RawTokenApproval): Promise<void> {
    const toTokenApprovals = (params: RawTokenApproval): TokenApproval[] => {
      if (Array.isArray(params)) return params.flatMap(toTokenApprovals);

      const { to: recipients, amount, from } = params;
      const to = Array.isArray(recipients) ? recipients : [recipients];

      return to.flatMap((to) =>
        Array.isArray(from) ? from.map((from) => ({ to, amount, from })) : [{ to, amount, from }]
      );
    };

    const params: TokenApproval[] = toTokenApprovals(rawParams);
    await Promise.all(
      params.flatMap(({ to, amount, from }) =>
        this.tokens.map(async (token) => (await token.connect(from)).approve(to.address, amount))
      )
    );
  }

  sort(): TokenList {
    return new TokenList(
      this.tokens.sort((tokenA, tokenB) => (tokenA.address.toLowerCase() > tokenB.address.toLowerCase() ? 1 : -1))
    );
  }
}
