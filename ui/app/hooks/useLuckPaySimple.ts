import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey, SystemProgram, Transaction, TransactionInstruction, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { useCallback } from 'react'
import * as borsh from '@coral-xyz/borsh'

const PROGRAM_ID = new PublicKey('5pDvSp5GGScmM4Wy3YK5mioe91mPMs62CoC8w2ps7KeP')

// Instruction discriminators from the IDL
const DISCRIMINATORS = {
  createGame: Buffer.from([124, 69, 75, 66, 184, 220, 72, 206]),
  requestRandomness: Buffer.from([213, 5, 173, 166, 37, 236, 31, 18]),
  resolveGame: Buffer.from([25, 119, 183, 229, 196, 69, 169, 79])
}

export function useLuckPaySimple() {
  const { connection } = useConnection()
  const { publicKey, sendTransaction } = useWallet()

  const getConfigPda = useCallback(() => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('config')],
      PROGRAM_ID
    )
  }, [])

  const getGamePda = useCallback((player: PublicKey, timestamp?: number) => {
    if (timestamp) {
      // Create unique game PDA with timestamp to avoid conflicts
      const timestampBuffer = Buffer.alloc(8)
      timestampBuffer.writeBigUInt64LE(BigInt(timestamp), 0)
      return PublicKey.findProgramAddressSync(
        [Buffer.from('game'), player.toBuffer(), timestampBuffer],
        PROGRAM_ID
      )
    } else {
      // Original PDA format
      return PublicKey.findProgramAddressSync(
        [Buffer.from('game'), player.toBuffer()],
        PROGRAM_ID
      )
    }
  }, [])

  const getTreasuryPda = useCallback(() => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('treasury')],
      PROGRAM_ID
    )
  }, [])

  const checkTreasuryBalance = useCallback(async (sendAmount: number) => {
    const [treasuryPda] = getTreasuryPda()
    const treasuryBalance = await connection.getBalance(treasuryPda)
    const escrowAmount = sendAmount * 2 // Total escrow is 2x send amount
    const requiredForRecipient = sendAmount
    const requiredForRefund = escrowAmount // Max if player wins
    const totalRequired = requiredForRecipient + requiredForRefund

    return {
      sufficient: treasuryBalance >= totalRequired,
      available: treasuryBalance,
      required: totalRequired,
      availableSOL: treasuryBalance / LAMPORTS_PER_SOL,
      requiredSOL: totalRequired / LAMPORTS_PER_SOL
    }
  }, [connection, getTreasuryPda])

  const initializeConfig = useCallback(async () => {
    if (!publicKey || !sendTransaction) {
      throw new Error('Wallet not connected')
    }

    console.log('🔧 Initializing config...')
    const [configPda] = getConfigPda()
    console.log('🔧 Config PDA:', configPda.toBase58())

    // Check if config already exists
    console.log('🔍 Checking if config already exists...')
    const configAccount = await connection.getAccountInfo(configPda)
    if (configAccount) {
      console.log('✅ Config already initialized')
      return configPda.toBase58()
    }

    console.log('🆕 Config not found, creating new one...')

    // Initialize config with default values
    const maxBetAmount = 5 * LAMPORTS_PER_SOL

    console.log('⚙️ Config parameters:', {
      houseEdge: '5% (hardcoded in contract)',
      maxBetAmount: maxBetAmount / LAMPORTS_PER_SOL
    })

    const initConfigData = Buffer.alloc(8 + 8) // discriminator + max_bet_amount (u64)
    const initDiscriminator = Buffer.from([208, 127, 21, 1, 194, 190, 196, 70])
    initDiscriminator.copy(initConfigData, 0)

    const maxBetBuf = Buffer.alloc(8)
    maxBetBuf.writeBigUInt64LE(BigInt(maxBetAmount), 0)
    maxBetBuf.copy(initConfigData, 8)

    console.log('📦 Init config data size:', initConfigData.length)

    const initInstruction = new TransactionInstruction({
      keys: [
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: PROGRAM_ID,
      data: initConfigData,
    })

    console.log('📤 Sending config initialization transaction...')
    const transaction = new Transaction().add(initInstruction)
    const latestBlockhash = await connection.getLatestBlockhash()
    transaction.recentBlockhash = latestBlockhash.blockhash
    transaction.feePayer = publicKey

    const signature = await sendTransaction(transaction, connection)
    console.log('✅ Config init transaction sent:', signature)

    await connection.confirmTransaction({
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    }, 'confirmed')

    console.log('✅ Config initialized with signature:', signature)
    return configPda.toBase58()
  }, [publicKey, sendTransaction, connection, getConfigPda])

  // Enhanced game flow with risk slider
  const playGame = useCallback(async (
    betAmount: number,
    recipient: PublicKey,
    choice: 'heads' | 'tails',
    discountPercentage: number = 100, // 0-100, where 100 = free, 50 = 50% discount
    onTransactionSigned?: (signature: string) => void
  ) => {
    if (!publicKey || !sendTransaction) {
      throw new Error('Wallet not connected')
    }

    try {
      console.log('🎮 Starting enhanced LuckPay game...')
      console.log('📊 Game parameters:', {
        betAmount: betAmount / LAMPORTS_PER_SOL,
        recipient: recipient.toBase58(),
        choice,
        player: publicKey.toBase58(),
        discountPercentage,
        houseEdge: '5% (hardcoded in contract)'
      })

      // Check wallet balance (need double bet amount for worst case - loss scenario)
      console.log('💰 Checking wallet balance...')
      const balance = await connection.getBalance(publicKey)
      const maxCost = betAmount * 2 // Worst case: send amount + protocol fee
      const minRequired = maxCost + 10000 // Add buffer for transaction fees

      console.log('💰 Balance check:', {
        currentBalance: balance / LAMPORTS_PER_SOL,
        maxCost: maxCost / LAMPORTS_PER_SOL,
        minRequired: minRequired / LAMPORTS_PER_SOL
      })

      if (balance < minRequired) {
        throw new Error(`Insufficient balance. Need at least ${minRequired / LAMPORTS_PER_SOL} SOL (worst case: ${maxCost / LAMPORTS_PER_SOL} SOL + fees)`)
      }

      // Check treasury balance to ensure it can pay out
      console.log('🏦 Checking treasury balance...')
      const treasuryCheck = await checkTreasuryBalance(betAmount)
      console.log('🏦 Treasury balance check:', treasuryCheck)

      if (!treasuryCheck.sufficient) {
        throw new Error(`Insufficient treasury balance. Available: ${treasuryCheck.availableSOL.toFixed(4)} SOL, Required: ${treasuryCheck.requiredSOL.toFixed(4)} SOL. Please try a smaller amount or wait for more funds to be added to the treasury.`)
      }

      // Ensure config is initialized
      console.log('⚙️ Initializing config...')
      await initializeConfig()

      console.log('🔑 Generating PDAs...')
      const [configPda] = getConfigPda()
      const [gamePda] = getGamePda(publicKey) // Use original format to match smart contract
      const [treasuryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('treasury')],
        PROGRAM_ID
      )

      console.log('🔑 PDAs generated:', {
        configPda: configPda.toBase58(),
        gamePda: gamePda.toBase58(),
        treasuryPda: treasuryPda.toBase58()
      })

      // Check if game PDA already exists
      console.log('🔍 Checking if game PDA already exists...')
      const existingGameAccount = await connection.getAccountInfo(gamePda)
      if (existingGameAccount) {
        console.log('⚠️ Game PDA already exists! Checking if it has corrupted data...')

        // Check if we can deserialize the game data
        try {
          // Try to read basic game data to see if it's corrupted
          if (existingGameAccount.data.length < 100) {
            console.log('⚠️ Game account has insufficient data, might be corrupted')
          }

          // For now, still throw error but with more helpful message
          throw new Error(`You have an active game that may be corrupted.

🔧 To resolve this issue:
1. Try the "Close Active Game" button below
2. If that fails, you may need to wait for the account to expire
3. Or create a new wallet temporarily

Game PDA: ${gamePda.toBase58()}`)
        } catch (parseError) {
          console.log('❌ Game data appears corrupted:', parseError)
          throw new Error(`Your game account appears corrupted. Please try closing it first or contact support.

Game PDA: ${gamePda.toBase58()}`)
        }
      } else {
        console.log('✅ Game PDA does not exist, proceeding with smart contract...')
      }

      // Smart contract approach - ALL INSTRUCTIONS IN ONE TRANSACTION
      console.log('🏗️ Building complete game flow in single transaction...')
      const choiceEnum = choice === 'heads' ? 0 : 1 // 0 = Heads, 1 = Tails

      console.log('📦 Serializing instruction data:', {
        choiceEnum,
        sendAmountBigInt: BigInt(betAmount).toString(),
        riskPercentage: discountPercentage
      })

      // Instruction 1: Create Game
      const createGameData = Buffer.alloc(8 + 8 + 32 + 1 + 1) // discriminator + send_amount + recipient + choice + risk_percentage
      DISCRIMINATORS.createGame.copy(createGameData, 0)

      // Write send amount (u64) - this is the amount to send to recipient
      const sendAmountBuf = Buffer.alloc(8)
      sendAmountBuf.writeBigUInt64LE(BigInt(betAmount), 0)
      sendAmountBuf.copy(createGameData, 8)

      // Write recipient (32 bytes)
      recipient.toBuffer().copy(createGameData, 16)

      // Write choice (1 byte)
      createGameData.writeUInt8(choiceEnum, 48)

      // Write risk_percentage (1 byte) - affects win probability
      createGameData.writeUInt8(discountPercentage, 49)

      const createGameInstruction = new TransactionInstruction({
        keys: [
          { pubkey: gamePda, isSigner: false, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: true },
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: treasuryPda, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID,
        data: createGameData,
      })

      // Instruction 2: Request Randomness
      const requestRandomnessData = Buffer.alloc(8)
      DISCRIMINATORS.requestRandomness.copy(requestRandomnessData, 0)

      const requestRandomnessInstruction = new TransactionInstruction({
        keys: [
          { pubkey: gamePda, isSigner: false, isWritable: true },
          { pubkey: publicKey, isSigner: true, isWritable: false },
        ],
        programId: PROGRAM_ID,
        data: requestRandomnessData,
      })

      // Instruction 3: Resolve Game
      const resolveGameData = Buffer.alloc(8)
      DISCRIMINATORS.resolveGame.copy(resolveGameData, 0)

      const resolveGameInstruction = new TransactionInstruction({
        keys: [
          { pubkey: gamePda, isSigner: false, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: true },
          { pubkey: publicKey, isSigner: true, isWritable: true }, // Player account for transfer
          { pubkey: recipient, isSigner: false, isWritable: true },
          { pubkey: treasuryPda, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID,
        data: resolveGameData,
      })

      // Create transaction with ALL THREE instructions
      console.log('🔨 Building complete transaction with all 3 instructions...')
      const transaction = new Transaction().add(
        createGameInstruction,
        requestRandomnessInstruction,
        resolveGameInstruction
      )

      console.log('📋 Transaction has', transaction.instructions.length, 'instructions')

      // Get recent blockhash and set up transaction
      console.log('🔗 Getting latest blockhash...')
      const latestBlockhash = await connection.getLatestBlockhash()
      transaction.recentBlockhash = latestBlockhash.blockhash
      transaction.feePayer = publicKey

      console.log('🔗 Transaction setup complete:', {
        blockhash: latestBlockhash.blockhash.slice(0, 8) + '...',
        feePayer: publicKey.toBase58()
      })

      console.log('📤 Sending single transaction with complete game flow:', {
        gamePda: gamePda.toBase58(),
        configPda: configPda.toBase58(),
        choice: choice,
        betAmount: betAmount / LAMPORTS_PER_SOL,
        instructions: ['create_game', 'request_randomness', 'resolve_game']
      })

      // Simulate the complete transaction
      console.log('🧪 Simulating complete game flow transaction...')
      let simulationResult: any = null
      try {
        simulationResult = await connection.simulateTransaction(transaction)
        console.log('🧪 Complete game simulation result:', simulationResult)

        if (simulationResult.value.err) {
          console.error('❌ Complete game simulation failed:', simulationResult.value.err)
          console.error('❌ Complete game simulation logs:', simulationResult.value.logs)
        } else {
          console.log('✅ Complete game simulation successful!')
          console.log('📊 Complete game simulation logs:', simulationResult.value.logs)
        }
      } catch (simError: any) {
        console.error('❌ Complete game simulation error:', simError)
      }

      // Send the single transaction with all instructions
      let gameSignature
      try {
        console.log('📤 Sending complete game transaction...')
        gameSignature = await sendTransaction(transaction, connection)
        console.log('✅ Complete game transaction sent! Signature:', gameSignature)

        // Notify that transaction has been signed
        if (onTransactionSigned) {
          onTransactionSigned(gameSignature)
        }
      } catch (sendError: any) {
        console.error('❌ Failed to send complete game transaction:', sendError)
        console.error('❌ Complete game send error details:', {
          name: sendError.name,
          message: sendError.message,
          code: sendError.code,
          stack: sendError.stack,
          logs: sendError.logs,
          err: sendError.err,
          toString: sendError.toString()
        })

        // Also log all properties
        console.error('❌ All complete game error properties:', Object.getOwnPropertyNames(sendError))
        for (const prop of Object.getOwnPropertyNames(sendError)) {
          console.error(`❌ ${prop}:`, sendError[prop])
        }

        throw new Error(`Complete game failed: ${sendError.message || sendError.toString() || 'Unknown wallet error'}`)
      }

      console.log('⏳ Waiting for complete game confirmation...')
      await connection.confirmTransaction({
        signature: gameSignature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      }, 'confirmed')
      console.log('✅ Complete game confirmed!')

      // Get the actual transaction logs from the confirmed transaction
      console.log('📋 Fetching actual transaction logs...')
      const transactionDetails = await connection.getTransaction(gameSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      })

      let actualTransactionLogs: string[] = []
      if (transactionDetails?.meta?.logMessages) {
        actualTransactionLogs = transactionDetails.meta.logMessages
        console.log('📋 Actual transaction logs:', actualTransactionLogs)
      } else {
        console.log('⚠️ No transaction logs found, falling back to simulation logs')
        actualTransactionLogs = simulationResult?.value?.logs || []
      }

      // Try to fetch the game account (may not exist if auto-closed)
      console.log('🔍 Checking if game account still exists...')
      const gameAccountInfo = await connection.getAccountInfo(gamePda)
      if (gameAccountInfo) {
        console.log('📊 Game account found after resolution (not auto-closed)')
        console.log('📊 Game account data length:', gameAccountInfo.data.length)

        // Parse the actual game result from the account data
        // Game struct layout: discriminator(8) + player(32) + recipient(32) + bet_amount(8) + choice(1) + discount_percentage(1) + game_state(1) + created_at(8) + vrf_client_state(33) + result(option + 3 bytes) + bump(1)

        let actualResult = null
        let randomValue = 0
        let coinResult: 'heads' | 'tails' = 'heads'
        let playerWon = false

        try {
          // Check if game has result (at offset after all other fields)
          // The result is an Option<GameResult> where GameResult has: coin_result(1) + player_won(1) + random_value(1)
          const resultOffset = 8 + 32 + 32 + 8 + 1 + 1 + 1 + 8 + 33 // Skip to result field

          if (gameAccountInfo.data.length > resultOffset + 1) {
            const hasResult = gameAccountInfo.data[resultOffset] // Option discriminator
            console.log('📊 Has result:', hasResult)

            if (hasResult === 1) { // Some(result)
              const coinResultByte = gameAccountInfo.data[resultOffset + 1]
              const playerWonByte = gameAccountInfo.data[resultOffset + 2]
              randomValue = gameAccountInfo.data[resultOffset + 3]

              coinResult = coinResultByte === 0 ? 'heads' : 'tails'
              playerWon = playerWonByte === 1

              console.log('📊 Parsed game result:', {
                coinResult,
                playerWon,
                randomValue,
                playerChoice: choice
              })
            } else {
              console.log('⚠️ Game result not found in account data')
              // Fallback to actual transaction logs analysis
              const winLog = actualTransactionLogs.find((log: string) => log.includes('Player WON!'))
              const loseLog = actualTransactionLogs.find((log: string) => log.includes('Player LOST!'))

              if (winLog) {
                playerWon = true
                coinResult = choice // If won, coin matched choice
              } else if (loseLog) {
                playerWon = false
                coinResult = choice === 'heads' ? 'tails' : 'heads' // If lost, coin was opposite
              }

              console.log('📊 Result from actual transaction logs:', { playerWon, coinResult })
            }
          }
        } catch (parseError) {
          console.error('❌ Error parsing game result:', parseError)
          // Fallback to actual transaction logs
          const winLog = actualTransactionLogs.find((log: string) => log.includes('Player WON!'))
          playerWon = !!winLog
          coinResult = playerWon ? choice : (choice === 'heads' ? 'tails' : 'heads')
        }

        // Calculate the total cost/outcome for the player
        let playerCost: number
        let playerRefund: number
        let recipientReceived: number

        if (playerWon) {
          playerCost = (betAmount * 2) / LAMPORTS_PER_SOL // Player paid 2x escrow upfront
          playerRefund = betAmount / LAMPORTS_PER_SOL // Player gets half back
          recipientReceived = betAmount / LAMPORTS_PER_SOL // Recipient gets amount from escrow
        } else {
          playerCost = (betAmount * 2) / LAMPORTS_PER_SOL // Player paid 2x escrow upfront
          playerRefund = 0 // Player gets nothing back
          recipientReceived = betAmount / LAMPORTS_PER_SOL // Recipient gets amount from escrow
        }

        console.log('🎯 Smart contract game completed successfully!')
        return {
          signature: gameSignature,
          result: {
            coinResult,
            playerWon,
            randomValue,
            playerCost,
            playerRefund,
            recipientReceived
          }
        }
      } else {
        // Game account not found = auto-closed! Parse result from actual transaction logs
        console.log('✅ Game account was auto-closed! Parsing result from actual transaction logs...')

        const winLog = actualTransactionLogs.find((log: string) => log.includes('Player WON!'))
        const loseLog = actualTransactionLogs.find((log: string) => log.includes('Player LOST!'))

        let playerWon = false
        let randomValue = 0
        let coinResult: 'heads' | 'tails' = 'heads'

        if (winLog) {
          playerWon = true
          // If player won, coin result matched their choice
          coinResult = choice
          // Extract random value from log: "Risk: 100%, Random: 140"
          const randomMatch = winLog.match(/Random: (\d+)/)
          if (randomMatch) {
            randomValue = parseInt(randomMatch[1])
          }
        } else if (loseLog) {
          playerWon = false
          // If player lost, coin result was opposite of their choice
          coinResult = choice === 'heads' ? 'tails' : 'heads'
          const randomMatch = loseLog.match(/Random: (\d+)/)
          if (randomMatch) {
            randomValue = parseInt(randomMatch[1])
          }
        }

        // Calculate costs based on auto-close win logic
        let playerCost = 0
        let playerRefund = 0
        let recipientReceived = betAmount / LAMPORTS_PER_SOL

        if (playerWon) {
          playerCost = 0 // FREE transfer when winning!
          playerRefund = (betAmount * 2) / LAMPORTS_PER_SOL // Full escrow back + rent refund
          recipientReceived = betAmount / LAMPORTS_PER_SOL
        } else {
          playerCost = (betAmount * 2) / LAMPORTS_PER_SOL // Lost full escrow
          playerRefund = 0
          recipientReceived = betAmount / LAMPORTS_PER_SOL
        }

        console.log('🎯 Auto-closed game completed successfully!')
        console.log('📊 Parsed result from actual transaction logs:', { playerWon, randomValue, coinResult })

        return {
          signature: gameSignature,
          result: {
            coinResult,
            playerWon,
            randomValue,
            playerCost,
            playerRefund,
            recipientReceived
          }
        }
      }

    } catch (error: any) {
      console.error('❌ GAME ERROR OCCURRED:', error)
      console.error('❌ Error details:', {
        name: error.name,
        message: error.message,
        code: error.code,
        stack: error.stack,
        cause: error.cause
      })

      // Log additional error context
      if (error.logs) {
        console.error('❌ Transaction logs:', error.logs)
      }
      if (error.err) {
        console.error('❌ Inner error:', error.err)
      }

      // Re-throw with cleaner error message
      if (error.message?.includes('insufficient')) {
        throw new Error(error.message)
      } else if (error.message?.includes('blockhash')) {
        throw new Error('Transaction failed: Network congestion. Please try again.')
      } else if (error.message?.includes('signature')) {
        throw new Error('Transaction failed: Please check your wallet and try again.')
      } else if (error.message?.includes('send failed')) {
        throw new Error(error.message) // Pass through send errors with details
      } else {
        throw new Error(`Smart contract game failed: ${error.message || 'Unknown error'}`)
      }
    }
  }, [publicKey, sendTransaction, connection, getConfigPda, getGamePda])

  const closeGame = useCallback(async () => {
    if (!publicKey || !sendTransaction) {
      throw new Error('Wallet not connected')
    }

    try {
      console.log('🗑️ Closing existing game...')
      console.log('🔑 Player public key:', publicKey.toBase58())

      const [gamePda] = getGamePda(publicKey)
      console.log('🔑 Generated Game PDA:', gamePda.toBase58())

      // Check if game exists and get detailed info
      console.log('🔍 Checking if game account exists...')
      const gameAccount = await connection.getAccountInfo(gamePda)
      if (!gameAccount) {
        console.log('❌ No game account found at PDA:', gamePda.toBase58())
        throw new Error('No active game found to close')
      }

      console.log('✅ Game account found!')
      console.log('📊 Game account details:', {
        owner: gameAccount.owner.toBase58(),
        lamports: gameAccount.lamports,
        dataLength: gameAccount.data.length,
        executable: gameAccount.executable,
        rentEpoch: gameAccount.rentEpoch
      })

      // Parse game data to check state
      if (gameAccount.data.length > 8) {
        console.log('📊 Game account data (first 100 bytes):', gameAccount.data.slice(0, 100))

        // Try to parse game state (it should be at offset 8 + 32 + 32 + 8 + 1 + 1 = 82)
        try {
          const gameStateOffset = 8 + 32 + 32 + 8 + 1 + 1; // discriminator + player + recipient + bet_amount + choice + discount_percentage
          if (gameAccount.data.length > gameStateOffset) {
            const gameState = gameAccount.data[gameStateOffset];
            console.log('🎮 Game state:', gameState, '(0=Created, 1=RandomnessRequested, 2=Resolved)');

            if (gameState !== 2) { // Not resolved
              console.log('⚠️ WARNING: Game is not in Resolved state. Close may fail.');
            }
          }
        } catch (parseError) {
          console.log('⚠️ Could not parse game state:', parseError);
        }
      }

      console.log('🔑 Close game instruction accounts:')
      console.log('  - Game PDA:', gamePda.toBase58(), '(writable)')
      console.log('  - Player:', publicKey.toBase58(), '(signer, writable)')
      console.log('  - Program ID:', PROGRAM_ID.toBase58())

      // Create close game instruction
      const closeGameData = Buffer.alloc(8)
      const closeDiscriminator = Buffer.from([237, 236, 157, 201, 253, 20, 248, 67]) // From IDL
      closeDiscriminator.copy(closeGameData, 0)

      console.log('📦 Close game instruction data:', {
        discriminator: Array.from(closeDiscriminator),
        dataLength: closeGameData.length
      })

      const closeGameInstruction = new TransactionInstruction({
        keys: [
          { pubkey: gamePda, isSigner: false, isWritable: true },
          { pubkey: publicKey, isSigner: true, isWritable: true },
        ],
        programId: PROGRAM_ID,
        data: closeGameData,
      })

      console.log('🔨 Building close game transaction...')
      const transaction = new Transaction().add(closeGameInstruction)
      const latestBlockhash = await connection.getLatestBlockhash()
      transaction.recentBlockhash = latestBlockhash.blockhash
      transaction.feePayer = publicKey

      console.log('🔗 Transaction details:', {
        blockhash: latestBlockhash.blockhash.slice(0, 8) + '...',
        feePayer: publicKey.toBase58(),
        instructionCount: transaction.instructions.length
      })

      // Simulate transaction first
      console.log('🧪 Simulating close game transaction...')
      try {
        const simulationResult = await connection.simulateTransaction(transaction)
        console.log('🧪 Close game simulation result:', simulationResult)

        if (simulationResult.value.err) {
          console.error('❌ Close game simulation failed:', simulationResult.value.err)
          console.error('❌ Close game simulation logs:', simulationResult.value.logs)
          throw new Error(`Close game simulation failed: ${JSON.stringify(simulationResult.value.err)}`)
        } else {
          console.log('✅ Close game simulation successful!')
          console.log('📊 Close game simulation logs:', simulationResult.value.logs)
        }
      } catch (simError: any) {
        console.error('❌ Close game simulation error:', simError)
        throw new Error(`Close game simulation failed: ${simError.message}`)
      }

      console.log('📤 Sending close game transaction...')
      let signature
      try {
        signature = await sendTransaction(transaction, connection)
        console.log('✅ Close game transaction sent! Signature:', signature)
      } catch (sendError: any) {
        console.error('❌ Failed to send close game transaction:', sendError)
        console.error('❌ Close game send error details:', {
          name: sendError.name,
          message: sendError.message,
          code: sendError.code,
          stack: sendError.stack,
          logs: sendError.logs,
          err: sendError.err
        })

        // Log all error properties
        console.error('❌ All close game error properties:', Object.getOwnPropertyNames(sendError))
        for (const prop of Object.getOwnPropertyNames(sendError)) {
          console.error(`❌ ${prop}:`, sendError[prop])
        }

        throw new Error(`Close game transaction failed: ${sendError.message || sendError.toString() || 'Unknown wallet error'}`)
      }

      console.log('⏳ Waiting for close game confirmation...')
      await connection.confirmTransaction({
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      }, 'confirmed')

      console.log('✅ Game closed successfully!')

      // Verify the game account was actually closed
      console.log('🔍 Verifying game account was closed...')
      const verifyAccount = await connection.getAccountInfo(gamePda)
      if (verifyAccount) {
        console.log('⚠️ WARNING: Game account still exists after close')
        console.log('📊 Remaining account details:', {
          owner: verifyAccount.owner.toBase58(),
          lamports: verifyAccount.lamports,
          dataLength: verifyAccount.data.length
        })
      } else {
        console.log('✅ Confirmed: Game account successfully closed and rent reclaimed')
      }

      return signature

    } catch (error: any) {
      console.error('❌ CLOSE GAME ERROR OCCURRED:', error)
      console.error('❌ Close game error details:', {
        name: error.name,
        message: error.message,
        code: error.code,
        stack: error.stack,
        cause: error.cause
      })

      // Log additional error context
      if (error.logs) {
        console.error('❌ Close game transaction logs:', error.logs)
      }
      if (error.err) {
        console.error('❌ Close game inner error:', error.err)
      }

      // Re-throw with more specific error message
      if (error.message?.includes('simulation failed')) {
        throw error // Already has detailed message
      } else if (error.message?.includes('insufficient')) {
        throw new Error(`Insufficient balance for transaction fees: ${error.message}`)
      } else if (error.message?.includes('blockhash')) {
        throw new Error('Transaction failed: Network congestion. Please try again.')
      } else if (error.message?.includes('signature')) {
        throw new Error('Transaction failed: Please check your wallet and try again.')
      } else {
        throw new Error(`Close game failed: ${error.message || 'Unknown error'}`)
      }
    }
  }, [publicKey, sendTransaction, connection, getGamePda])


  return {
    publicKey,
    connection,
    playGame,
    closeGame,
    initializeConfig,
    getConfigPda,
    getGamePda,
    getTreasuryPda,
    checkTreasuryBalance,
  }
}