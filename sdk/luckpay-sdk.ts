import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Luckpay } from "../target/types/luckpay";
import { PublicKey, Keypair, SystemProgram, Connection, Transaction } from "@solana/web3.js";

export enum CoinSide {
  Heads = "heads",
  Tails = "tails"
}

export interface GameResult {
  coinResult: CoinSide;
  playerWon: boolean;
  randomValue: number;
}

export interface GameAccount {
  player: PublicKey;
  recipient: PublicKey;
  betAmount: anchor.BN;
  choice: CoinSide;
  gameState: any;
  createdAt: anchor.BN;
  vrfClientState?: PublicKey;
  result?: GameResult;
  bump: number;
}

export interface ConfigAccount {
  authority: PublicKey;
  houseEdge: number;
  maxBetAmount: anchor.BN;
  totalGames: anchor.BN;
  totalVolume: anchor.BN;
  bump: number;
}

export class LuckPaySDK {
  private program: Program<Luckpay>;
  private provider: anchor.AnchorProvider;

  constructor(
    connection: Connection,
    wallet: anchor.Wallet,
    programId?: PublicKey
  ) {
    this.provider = new anchor.AnchorProvider(connection, wallet, {});
    anchor.setProvider(this.provider);

    if (programId) {
      this.program = new Program(require("../target/idl/luckpay.json"), programId, this.provider);
    } else {
      this.program = anchor.workspace.luckpay as Program<Luckpay>;
    }
  }

  /**
   * Get the config PDA address
   */
  getConfigPda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      this.program.programId
    );
  }

  /**
   * Get a game PDA address
   */
  getGamePda(player: PublicKey, timestamp: number): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("game"),
        player.toBuffer(),
        Buffer.from(timestamp.toString().padStart(8, '0'), 'hex')
      ],
      this.program.programId
    );
  }

  /**
   * Initialize the LuckPay config
   */
  async initializeConfig(
    authority: Keypair,
    maxBetAmount: number
  ): Promise<string> {
    const [configPda] = this.getConfigPda();

    return await this.program.methods
      .initializeConfig(new anchor.BN(maxBetAmount))
      .accounts({
        config: configPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
  }

  /**
   * Create a new coin flip game
   */
  async createGame(
    player: Keypair,
    betAmount: number,
    recipient: PublicKey,
    choice: CoinSide
  ): Promise<{ txId: string; gamePda: PublicKey; timestamp: number }> {
    const [configPda] = this.getConfigPda();
    const timestamp = Math.floor(Date.now() / 1000);
    const [gamePda] = this.getGamePda(player.publicKey, timestamp);

    const choiceObj = choice === CoinSide.Heads ? { heads: {} } : { tails: {} };

    const txId = await this.program.methods
      .createGame(new anchor.BN(betAmount), recipient, choiceObj)
      .accounts({
        game: gamePda,
        config: configPda,
        player: player.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([player])
      .rpc();

    return { txId, gamePda, timestamp };
  }

  /**
   * Request randomness for a game (requires Switchboard VRF setup)
   */
  async requestRandomness(
    gamePda: PublicKey,
    vrfAccount: PublicKey,
    oracleQueue: PublicKey,
    queueAuthority: PublicKey,
    dataBuffer: PublicKey,
    permission: PublicKey,
    escrow: PublicKey,
    payer: Keypair,
    recentBlockhashes: PublicKey,
    programState: PublicKey,
    tokenProgram: PublicKey
  ): Promise<string> {
    return await this.program.methods
      .requestRandomness()
      .accounts({
        game: gamePda,
        vrf: vrfAccount,
        oracleQueue,
        queueAuthority,
        dataBuffer,
        permission,
        escrow,
        payer: payer.publicKey,
        recentBlockhashes,
        programState,
        tokenProgram,
      })
      .signers([payer])
      .rpc();
  }

  /**
   * Resolve a game after randomness is available
   */
  async resolveGame(
    gamePda: PublicKey,
    vrfAccount: PublicKey,
    playerAccount: PublicKey,
    recipient: PublicKey
  ): Promise<string> {
    const [configPda] = this.getConfigPda();

    return await this.program.methods
      .resolveGame()
      .accounts({
        game: gamePda,
        config: configPda,
        vrf: vrfAccount,
        playerAccount,
        recipient,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /**
   * Close a completed game and reclaim rent
   */
  async closeGame(gamePda: PublicKey, player: Keypair): Promise<string> {
    return await this.program.methods
      .closeGame()
      .accounts({
        game: gamePda,
        player: player.publicKey,
      })
      .signers([player])
      .rpc();
  }

  /**
   * Get config account data
   */
  async getConfig(): Promise<ConfigAccount | null> {
    try {
      const [configPda] = this.getConfigPda();
      return await this.program.account.config.fetch(configPda) as ConfigAccount;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get game account data
   */
  async getGame(gamePda: PublicKey): Promise<GameAccount | null> {
    try {
      return await this.program.account.game.fetch(gamePda) as GameAccount;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get all games for a player
   */
  async getPlayerGames(player: PublicKey): Promise<{ pubkey: PublicKey; account: GameAccount }[]> {
    const games = await this.program.account.game.all([
      {
        memcmp: {
          offset: 8, // Skip discriminator
          bytes: player.toBase58(),
        },
      },
    ]);

    return games as { pubkey: PublicKey; account: GameAccount }[];
  }

  /**
   * Subscribe to game account changes
   */
  subscribeToGame(
    gamePda: PublicKey,
    callback: (game: GameAccount) => void
  ): number {
    return this.program.account.game.subscribe(gamePda, "confirmed")
      .on("change", callback)
      .id;
  }

  /**
   * Unsubscribe from game account changes
   */
  unsubscribeFromGame(subscriptionId: number): void {
    this.program.account.game.unsubscribe(subscriptionId);
  }

  /**
   * Get the treasury PDA address
   */
  getTreasuryPda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      this.program.programId
    );
  }

  /**
   * Get treasury balance in lamports
   */
  async getTreasuryBalance(): Promise<number> {
    const [treasuryPda] = this.getTreasuryPda();
    return await this.provider.connection.getBalance(treasuryPda);
  }

  /**
   * Check if treasury has sufficient balance for a game
   */
  async checkTreasuryBalance(sendAmount: number): Promise<{ sufficient: boolean; available: number; required: number }> {
    const treasuryBalance = await this.getTreasuryBalance();
    const escrowAmount = sendAmount * 2; // Total escrow is 2x send amount
    const required = sendAmount + escrowAmount; // Max required (if player wins)

    return {
      sufficient: treasuryBalance >= required,
      available: treasuryBalance,
      required: required
    };
  }

  /**
   * Get program ID
   */
  getProgramId(): PublicKey {
    return this.program.programId;
  }

  /**
   * Utility: Convert lamports to SOL
   */
  static lamportsToSol(lamports: number): number {
    return lamports / anchor.web3.LAMPORTS_PER_SOL;
  }

  /**
   * Utility: Convert SOL to lamports
   */
  static solToLamports(sol: number): number {
    return sol * anchor.web3.LAMPORTS_PER_SOL;
  }
}

export default LuckPaySDK;