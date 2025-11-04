import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Luckpay } from "../target/types/luckpay";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";

describe("LuckPay Enhanced Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.luckpay as Program<Luckpay>;
  const authority = provider.wallet as anchor.Wallet;

  let configPda: PublicKey;
  let configBump: number;
  let player: Keypair;
  let recipient: Keypair;

  before(async () => {
    // Find config PDA
    [configPda, configBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );

    // Create test keypairs
    player = Keypair.generate();
    recipient = Keypair.generate();

    // Airdrop SOL to test accounts
    await provider.connection.requestAirdrop(player.publicKey, 10 * LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(recipient.publicKey, 1 * LAMPORTS_PER_SOL);

    // Wait for airdrops to complete
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  describe("Configuration", () => {
    it("Initializes the config correctly", async () => {
      const houseEdge = 200; // 2%
      const maxBetAmount = new BN(5 * LAMPORTS_PER_SOL);

      const tx = await program.methods
        .initializeConfig(houseEdge, maxBetAmount)
        .accounts({
          config: configPda,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("✅ Config initialized:", tx);

      // Verify config was created correctly
      const config = await program.account.config.fetch(configPda);
      expect(config.authority.toBase58()).to.equal(authority.publicKey.toBase58());
      expect(config.houseEdge).to.equal(houseEdge);
      expect(config.maxBetAmount.toNumber()).to.equal(maxBetAmount.toNumber());
      expect(config.totalGames.toNumber()).to.equal(0);
      expect(config.totalVolume.toNumber()).to.equal(0);
    });
  });

  describe("Game Creation", () => {
    it("Creates a game with discount percentage", async () => {
      const betAmount = new BN(0.1 * LAMPORTS_PER_SOL);
      const choice = { heads: {} };
      const discountPercentage = 100; // 100% = FREE

      // Find game PDA (using original format without timestamp)
      const [gamePda, gameBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("game"), player.publicKey.toBuffer()],
        program.programId
      );

      const playerBalanceBefore = await provider.connection.getBalance(player.publicKey);

      const tx = await program.methods
        .createGame(betAmount, recipient.publicKey, choice, discountPercentage)
        .accounts({
          game: gamePda,
          config: configPda,
          player: player.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([player])
        .rpc();

      console.log("✅ Game created:", tx);

      // Verify game was created correctly
      const game = await program.account.game.fetch(gamePda);
      expect(game.player.toBase58()).to.equal(player.publicKey.toBase58());
      expect(game.recipient.toBase58()).to.equal(recipient.publicKey.toBase58());
      expect(game.betAmount.toNumber()).to.equal(betAmount.toNumber());
      expect(game.choice).to.deep.equal(choice);
      expect(game.discountPercentage).to.equal(discountPercentage);
      expect(game.gameState).to.deep.equal({ created: {} });

      // Verify NO money was deducted during game creation (only account creation fee)
      const playerBalanceAfter = await provider.connection.getBalance(player.publicKey);
      const balanceDiff = playerBalanceBefore - playerBalanceAfter;

      // Should only lose account creation rent + tx fees (much less than bet amount)
      expect(balanceDiff).to.be.lessThan(0.01 * LAMPORTS_PER_SOL);
    });

    it("Fails to create game with bet amount exceeding maximum", async () => {
      const betAmount = new BN(10 * LAMPORTS_PER_SOL); // Exceeds 5 SOL max
      const choice = { heads: {} };
      const discountPercentage = 50;

      // Use different player for unique PDA
      const testPlayer = Keypair.generate();
      await provider.connection.requestAirdrop(testPlayer.publicKey, 15 * LAMPORTS_PER_SOL);
      await new Promise(resolve => setTimeout(resolve, 1000));

      const [gamePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("game"), testPlayer.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .createGame(betAmount, recipient.publicKey, choice, discountPercentage)
          .accounts({
            game: gamePda,
            config: configPda,
            player: testPlayer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([testPlayer])
          .rpc();

        expect.fail("Expected transaction to fail due to bet amount exceeding maximum");
      } catch (error) {
        expect(error.toString()).to.include("BetTooHigh");
      }
    });

    it("Fails to create game with zero bet amount", async () => {
      const betAmount = new BN(0);
      const choice = { tails: {} };
      const discountPercentage = 25;

      const testPlayer = Keypair.generate();
      await provider.connection.requestAirdrop(testPlayer.publicKey, 2 * LAMPORTS_PER_SOL);
      await new Promise(resolve => setTimeout(resolve, 1000));

      const [gamePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("game"), testPlayer.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .createGame(betAmount, recipient.publicKey, choice, discountPercentage)
          .accounts({
            game: gamePda,
            config: configPda,
            player: testPlayer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([testPlayer])
          .rpc();

        expect.fail("Expected transaction to fail due to zero bet amount");
      } catch (error) {
        expect(error.toString()).to.include("InvalidBetAmount");
      }
    });
  });

  describe("Game Flow", () => {
    let testPlayer: Keypair;
    let testRecipient: Keypair;
    let gamePda: PublicKey;
    let betAmount: BN;

    beforeEach(async () => {
      // Create fresh test accounts for each test
      testPlayer = Keypair.generate();
      testRecipient = Keypair.generate();

      await provider.connection.requestAirdrop(testPlayer.publicKey, 5 * LAMPORTS_PER_SOL);
      await provider.connection.requestAirdrop(testRecipient.publicKey, 0.5 * LAMPORTS_PER_SOL);
      await new Promise(resolve => setTimeout(resolve, 1000));

      betAmount = new BN(0.1 * LAMPORTS_PER_SOL);

      [gamePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("game"), testPlayer.publicKey.toBuffer()],
        program.programId
      );
    });

    it("Completes full game flow: create → request → resolve", async () => {
      const choice = { heads: {} };
      const discountPercentage = 100; // FREE

      // Step 1: Create Game
      await program.methods
        .createGame(betAmount, testRecipient.publicKey, choice, discountPercentage)
        .accounts({
          game: gamePda,
          config: configPda,
          player: testPlayer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([testPlayer])
        .rpc();

      let game = await program.account.game.fetch(gamePda);
      expect(game.gameState).to.deep.equal({ created: {} });

      // Step 2: Request Randomness
      await program.methods
        .requestRandomness()
        .accounts({
          game: gamePda,
          player: testPlayer.publicKey,
        })
        .signers([testPlayer])
        .rpc();

      game = await program.account.game.fetch(gamePda);
      expect(game.gameState).to.deep.equal({ randomnessRequested: {} });

      // Step 3: Resolve Game
      const playerBalanceBefore = await provider.connection.getBalance(testPlayer.publicKey);
      const recipientBalanceBefore = await provider.connection.getBalance(testRecipient.publicKey);

      await program.methods
        .resolveGame()
        .accounts({
          game: gamePda,
          config: configPda,
          playerAccount: testPlayer.publicKey,
          recipient: testRecipient.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([testPlayer])
        .rpc();

      game = await program.account.game.fetch(gamePda);
      expect(game.gameState).to.deep.equal({ resolved: {} });
      expect(game.result).to.not.be.null;

      // Check balances after resolution
      const playerBalanceAfter = await provider.connection.getBalance(testPlayer.publicKey);
      const recipientBalanceAfter = await provider.connection.getBalance(testRecipient.publicKey);

      const playerBalanceChange = playerBalanceBefore - playerBalanceAfter;
      const recipientBalanceChange = recipientBalanceAfter - recipientBalanceBefore;

      console.log(`🎲 Game Result: ${game.result.coinResult}, Player Won: ${game.result.playerWon}`);
      console.log(`💰 Player Balance Change: ${playerBalanceChange / LAMPORTS_PER_SOL} SOL`);
      console.log(`💰 Recipient Balance Change: ${recipientBalanceChange / LAMPORTS_PER_SOL} SOL`);

      if (game.result.playerWon) {
        // Player won with 100% discount = should be FREE
        expect(recipientBalanceChange).to.equal(0);
        // Player should only lose tx fees (very small amount)
        expect(playerBalanceChange).to.be.lessThan(0.01 * LAMPORTS_PER_SOL);
      } else {
        // Player lost = should pay double
        const expectedAmount = betAmount.toNumber() * 2;
        expect(recipientBalanceChange).to.equal(expectedAmount);
        expect(playerBalanceChange).to.be.approximately(expectedAmount, 0.01 * LAMPORTS_PER_SOL);
      }
    });

    it("Tests win condition with 75% discount", async () => {
      const choice = { tails: {} };
      const discountPercentage = 75; // 75% discount

      // Create and complete game
      await program.methods
        .createGame(betAmount, testRecipient.publicKey, choice, discountPercentage)
        .accounts({
          game: gamePda,
          config: configPda,
          player: testPlayer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([testPlayer])
        .rpc();

      await program.methods
        .requestRandomness()
        .accounts({
          game: gamePda,
          player: testPlayer.publicKey,
        })
        .signers([testPlayer])
        .rpc();

      const playerBalanceBefore = await provider.connection.getBalance(testPlayer.publicKey);
      const recipientBalanceBefore = await provider.connection.getBalance(testRecipient.publicKey);

      await program.methods
        .resolveGame()
        .accounts({
          game: gamePda,
          config: configPda,
          playerAccount: testPlayer.publicKey,
          recipient: testRecipient.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([testPlayer])
        .rpc();

      const game = await program.account.game.fetch(gamePda);
      const playerBalanceAfter = await provider.connection.getBalance(testPlayer.publicKey);
      const recipientBalanceAfter = await provider.connection.getBalance(testRecipient.publicKey);

      const recipientBalanceChange = recipientBalanceAfter - recipientBalanceBefore;

      console.log(`🎲 75% Discount Game - Player Won: ${game.result.playerWon}`);

      if (game.result.playerWon) {
        // With 75% discount, player should pay 25% of bet amount
        const expectedAmount = Math.floor(betAmount.toNumber() * 0.25);
        expect(recipientBalanceChange).to.equal(expectedAmount);
      } else {
        // Player lost = should pay double
        const expectedAmount = betAmount.toNumber() * 2;
        expect(recipientBalanceChange).to.equal(expectedAmount);
      }
    });

    it("Tests win condition with 0% discount (no discount)", async () => {
      const choice = { heads: {} };
      const discountPercentage = 0; // No discount

      // Create and complete game
      await program.methods
        .createGame(betAmount, testRecipient.publicKey, choice, discountPercentage)
        .accounts({
          game: gamePda,
          config: configPda,
          player: testPlayer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([testPlayer])
        .rpc();

      await program.methods
        .requestRandomness()
        .accounts({
          game: gamePda,
          player: testPlayer.publicKey,
        })
        .signers([testPlayer])
        .rpc();

      const recipientBalanceBefore = await provider.connection.getBalance(testRecipient.publicKey);

      await program.methods
        .resolveGame()
        .accounts({
          game: gamePda,
          config: configPda,
          playerAccount: testPlayer.publicKey,
          recipient: testRecipient.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([testPlayer])
        .rpc();

      const game = await program.account.game.fetch(gamePda);
      const recipientBalanceAfter = await provider.connection.getBalance(testRecipient.publicKey);
      const recipientBalanceChange = recipientBalanceAfter - recipientBalanceBefore;

      console.log(`🎲 No Discount Game - Player Won: ${game.result.playerWon}`);

      if (game.result.playerWon) {
        // With 0% discount, player should pay full bet amount
        expect(recipientBalanceChange).to.equal(betAmount.toNumber());
      } else {
        // Player lost = should pay double
        expect(recipientBalanceChange).to.equal(betAmount.toNumber() * 2);
      }
    });
  });

  describe("Error Cases", () => {
    it("Fails to request randomness before game creation", async () => {
      const testPlayer = Keypair.generate();
      const [gamePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("game"), testPlayer.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .requestRandomness()
          .accounts({
            game: gamePda,
            player: testPlayer.publicKey,
          })
          .signers([testPlayer])
          .rpc();

        expect.fail("Expected transaction to fail - game doesn't exist");
      } catch (error) {
        // Should fail because game account doesn't exist
        expect(error.toString()).to.include("AccountNotInitialized");
      }
    });

    it("Fails to resolve game before requesting randomness", async () => {
      const testPlayer = Keypair.generate();
      await provider.connection.requestAirdrop(testPlayer.publicKey, 2 * LAMPORTS_PER_SOL);
      await new Promise(resolve => setTimeout(resolve, 1000));

      const testRecipient = Keypair.generate();
      const betAmount = new BN(0.1 * LAMPORTS_PER_SOL);
      const [gamePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("game"), testPlayer.publicKey.toBuffer()],
        program.programId
      );

      // Create game but don't request randomness
      await program.methods
        .createGame(betAmount, testRecipient.publicKey, { heads: {} }, 50)
        .accounts({
          game: gamePda,
          config: configPda,
          player: testPlayer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([testPlayer])
        .rpc();

      try {
        await program.methods
          .resolveGame()
          .accounts({
            game: gamePda,
            config: configPda,
            playerAccount: testPlayer.publicKey,
            recipient: testRecipient.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([testPlayer])
          .rpc();

        expect.fail("Expected transaction to fail - randomness not requested");
      } catch (error) {
        expect(error.toString()).to.include("InvalidGameState");
      }
    });
  });

  describe("Game Cleanup", () => {
    it("Successfully closes a resolved game", async () => {
      const testPlayer = Keypair.generate();
      const testRecipient = Keypair.generate();

      await provider.connection.requestAirdrop(testPlayer.publicKey, 3 * LAMPORTS_PER_SOL);
      await new Promise(resolve => setTimeout(resolve, 1000));

      const betAmount = new BN(0.05 * LAMPORTS_PER_SOL);
      const [gamePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("game"), testPlayer.publicKey.toBuffer()],
        program.programId
      );

      // Complete full game flow
      await program.methods
        .createGame(betAmount, testRecipient.publicKey, { heads: {} }, 100)
        .accounts({
          game: gamePda,
          config: configPda,
          player: testPlayer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([testPlayer])
        .rpc();

      await program.methods
        .requestRandomness()
        .accounts({
          game: gamePda,
          player: testPlayer.publicKey,
        })
        .signers([testPlayer])
        .rpc();

      await program.methods
        .resolveGame()
        .accounts({
          game: gamePda,
          config: configPda,
          playerAccount: testPlayer.publicKey,
          recipient: testRecipient.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([testPlayer])
        .rpc();

      // Now close the game
      const playerBalanceBefore = await provider.connection.getBalance(testPlayer.publicKey);

      await program.methods
        .closeGame()
        .accounts({
          game: gamePda,
          player: testPlayer.publicKey,
        })
        .signers([testPlayer])
        .rpc();

      // Verify game account was closed and rent was reclaimed
      const playerBalanceAfter = await provider.connection.getBalance(testPlayer.publicKey);
      expect(playerBalanceAfter).to.be.greaterThan(playerBalanceBefore);

      // Verify game account no longer exists
      try {
        await program.account.game.fetch(gamePda);
        expect.fail("Game account should have been closed");
      } catch (error) {
        expect(error.toString()).to.include("AccountNotInitialized");
      }
    });
  });
});