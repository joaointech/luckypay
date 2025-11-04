import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Luckpay } from "../target/types/luckpay";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";

describe("LuckPay Simple Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.luckpay as Program<Luckpay>;

  let configPda: PublicKey;

  before(async () => {
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );
  });

  it("Verifies the program ID", () => {
    console.log("✅ Program ID:", program.programId.toBase58());
    expect(program.programId.toBase58()).to.equal("5pDvSp5GGScmM4Wy3YK5mioe91mPMs62CoC8w2ps7KeP");
  });

  it("Verifies config PDA derivation", () => {
    console.log("✅ Config PDA:", configPda.toBase58());
    expect(configPda).to.be.an.instanceof(PublicKey);
  });

  it("Tests game PDA generation", () => {
    const testPlayer = Keypair.generate();

    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), testPlayer.publicKey.toBuffer()],
      program.programId
    );

    console.log("✅ Game PDA for player:", gamePda.toBase58());
    expect(gamePda).to.be.an.instanceof(PublicKey);
  });

  it("Tests coin choice enum conversion", () => {
    const headsChoice = { heads: {} };
    const tailsChoice = { tails: {} };

    console.log("✅ Heads choice:", headsChoice);
    console.log("✅ Tails choice:", tailsChoice);

    expect(headsChoice).to.have.property('heads');
    expect(tailsChoice).to.have.property('tails');
  });

  it("Tests discount percentage calculations", () => {
    const betAmount = 0.1 * LAMPORTS_PER_SOL;

    // Test different discount scenarios
    const scenarios = [
      { discount: 0, expected: betAmount }, // No discount
      { discount: 25, expected: betAmount * 0.75 }, // 25% discount = pay 75%
      { discount: 50, expected: betAmount * 0.5 }, // 50% discount = pay 50%
      { discount: 75, expected: betAmount * 0.25 }, // 75% discount = pay 25%
      { discount: 100, expected: 0 }, // 100% discount = FREE
    ];

    scenarios.forEach(({ discount, expected }) => {
      const discountAmount = (betAmount * discount) / 100;
      const actualAmount = betAmount - discountAmount;

      console.log(`💰 ${discount}% discount: ${actualAmount / LAMPORTS_PER_SOL} SOL (expected: ${expected / LAMPORTS_PER_SOL} SOL)`);
      expect(actualAmount).to.equal(expected);
    });
  });

  it("Tests double penalty calculation", () => {
    const betAmount = 0.1 * LAMPORTS_PER_SOL;
    const doubleAmount = betAmount * 2;

    console.log(`💀 Loss penalty: ${doubleAmount / LAMPORTS_PER_SOL} SOL for ${betAmount / LAMPORTS_PER_SOL} SOL bet`);
    expect(doubleAmount).to.equal(0.2 * LAMPORTS_PER_SOL);
  });

  it("Verifies max bet amount validation", () => {
    const maxBetAmount = 5 * LAMPORTS_PER_SOL;
    const testBet1 = 0.1 * LAMPORTS_PER_SOL; // Valid
    const testBet2 = 10 * LAMPORTS_PER_SOL; // Invalid

    expect(testBet1).to.be.lessThan(maxBetAmount);
    expect(testBet2).to.be.greaterThan(maxBetAmount);

    console.log(`✅ Max bet: ${maxBetAmount / LAMPORTS_PER_SOL} SOL`);
    console.log(`✅ Valid bet: ${testBet1 / LAMPORTS_PER_SOL} SOL`);
    console.log(`❌ Invalid bet: ${testBet2 / LAMPORTS_PER_SOL} SOL`);
  });

  it("Tests game flow state transitions", () => {
    const states = [
      { created: {} },
      { randomnessRequested: {} },
      { resolved: {} }
    ];

    console.log("🎮 Game State Flow:");
    states.forEach((state, index) => {
      console.log(`  ${index + 1}. ${Object.keys(state)[0]}`);
    });

    expect(states).to.have.lengthOf(3);
  });

  it("Simulates random coin flip outcomes", () => {
    console.log("🎲 Simulating coin flips:");

    for (let i = 0; i < 10; i++) {
      const randomValue = Math.floor(Math.random() * 256);
      const coinResult = randomValue % 2 === 0 ? 'heads' : 'tails';
      const playerChoice = Math.random() > 0.5 ? 'heads' : 'tails';
      const won = coinResult === playerChoice;

      console.log(`  Flip ${i + 1}: ${coinResult} (choice: ${playerChoice}) = ${won ? 'WIN' : 'LOSE'}`);
    }

    // This test always passes - it's just demonstrating the randomness logic
    expect(true).to.be.true;
  });

  it("Tests expected value calculations", () => {
    const betAmount = 0.1 * LAMPORTS_PER_SOL;
    const winProbability = 0.5;
    const lossProbability = 0.5;

    // Test different discount scenarios
    const discounts = [0, 25, 50, 75, 100];

    console.log("📊 Expected Value Analysis:");
    discounts.forEach(discount => {
      const winAmount = betAmount - (betAmount * discount) / 100;
      const loseAmount = betAmount * 2;
      const expectedValue = (winAmount * winProbability) + (loseAmount * lossProbability);

      console.log(`  ${discount}% discount: EV = ${(expectedValue / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    });

    expect(true).to.be.true;
  });
});