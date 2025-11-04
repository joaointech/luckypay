import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import LuckPaySDK, { CoinSide } from "./luckpay-sdk";

// Example usage of the LuckPay SDK
async function example() {
  // Setup connection and wallet
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = new Wallet(Keypair.generate()); // Replace with your wallet

  // Initialize SDK
  const luckPay = new LuckPaySDK(connection, wallet);

  // 1. Initialize config (only needs to be done once by the authority)
  const authority = Keypair.generate(); // The program authority
  try {
    const configTx = await luckPay.initializeConfig(
      authority,
      200, // 2% house edge
      5 * 1e9 // 5 SOL max bet
    );
    console.log("Config initialized:", configTx);
  } catch (error) {
    console.log("Config already exists or error:", error);
  }

  // 2. Create a game
  const player = Keypair.generate(); // The player
  const recipient = new PublicKey("11111111111111111111111111111112"); // Recipient address

  try {
    const gameResult = await luckPay.createGame(
      player,
      1 * 1e9, // 1 SOL bet
      recipient,
      CoinSide.Heads // Player chooses heads
    );

    console.log("Game created:", gameResult);
    console.log("Game PDA:", gameResult.gamePda.toBase58());

    // 3. Get game data
    const gameData = await luckPay.getGame(gameResult.gamePda);
    console.log("Game data:", gameData);

    // 4. Subscribe to game changes
    const subscriptionId = luckPay.subscribeToGame(gameResult.gamePda, (game) => {
      console.log("Game updated:", game);
    });

    // 5. In a real implementation, you would:
    // - Request randomness using Switchboard VRF
    // - Wait for the randomness to be fulfilled
    // - Resolve the game with the random result

    /*
    // Request randomness (requires Switchboard VRF setup)
    const randomnessTx = await luckPay.requestRandomness(
      gameResult.gamePda,
      vrfAccount,
      oracleQueue,
      queueAuthority,
      dataBuffer,
      permission,
      escrow,
      player,
      recentBlockhashes,
      programState,
      tokenProgram
    );

    // Resolve game after randomness is available
    const resolveTx = await luckPay.resolveGame(
      gameResult.gamePda,
      vrfAccount,
      player.publicKey,
      recipient
    );

    // Close game to reclaim rent
    const closeTx = await luckPay.closeGame(gameResult.gamePda, player);
    */

    // Clean up subscription
    setTimeout(() => {
      luckPay.unsubscribeFromGame(subscriptionId);
    }, 10000);

  } catch (error) {
    console.error("Error:", error);
  }

  // 6. Get config
  const config = await luckPay.getConfig();
  console.log("Config:", config);

  // 7. Get all games for a player
  const playerGames = await luckPay.getPlayerGames(player.publicKey);
  console.log("Player games:", playerGames);
}

// Run the example
example().catch(console.error);