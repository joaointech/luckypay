'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { resolve } from '@bonfida/spl-name-service'
import { BrowserQRCodeReader } from '@zxing/browser'
import toast, { Toaster } from 'react-hot-toast'
import { useLuckPaySimple } from '../hooks/useLuckPaySimple'

// QR Code Scanner Component
function QRScanner({ isOpen, onClose, onScan }: {
  isOpen: boolean
  onClose: () => void
  onScan: (result: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [error, setError] = useState('')
  const codeReaderRef = useRef<BrowserQRCodeReader | null>(null)

  useEffect(() => {
    if (isOpen && !isScanning) {
      startScanning()
    }

    return () => {
      stopScanning()
    }
  }, [isOpen])

  const startScanning = async () => {
    try {
      setError('')
      setIsScanning(true)

      codeReaderRef.current = new BrowserQRCodeReader()

      // Get video devices
      const videoInputDevices = await BrowserQRCodeReader.listVideoInputDevices()
      if (videoInputDevices.length === 0) {
        throw new Error('No camera found')
      }

      // Use back camera if available, otherwise use first camera
      const selectedDeviceId = videoInputDevices.find(device =>
        device.label.toLowerCase().includes('back') ||
        device.label.toLowerCase().includes('rear')
      )?.deviceId || videoInputDevices[0].deviceId

      // Start scanning
      if (videoRef.current) {
        const result = await codeReaderRef.current.decodeOnceFromVideoDevice(selectedDeviceId, videoRef.current)
        if (result) {
          onScan(result.getText())
          onClose()
        }
      }
    } catch (err: any) {
      console.error('QR scanning error:', err)
      setError(err.message || 'Failed to start camera')
      setIsScanning(false)
    }
  }

  const stopScanning = () => {
    if (codeReaderRef.current) {
      codeReaderRef.current = null
    }
    setIsScanning(false)
  }

  const handleClose = () => {
    stopScanning()
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl p-6 text-center shadow-2xl max-w-md w-full">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Scan QR Code</h3>
          <button
            onClick={handleClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
          >
            ×
          </button>
        </div>

        {error ? (
          <div className="text-center py-8">
            <div className="text-red-600 mb-4">❌ {error}</div>
            <button
              onClick={startScanning}
              className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg"
            >
              Try Again
            </button>
          </div>
        ) : (
          <div className="relative">
            <video
              ref={videoRef}
              className="w-full h-64 object-cover rounded-lg bg-gray-100"
              playsInline
              muted
            />
            {isScanning && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="border-2 border-purple-500 w-48 h-48 rounded-lg opacity-50"></div>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 text-sm text-gray-600">
          Point your camera at a QR code containing a Solana address
        </div>

        <button
          onClick={handleClose}
          className="mt-4 w-full bg-gray-600 hover:bg-gray-700 text-white font-semibold py-3 rounded-lg"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// 3D Coin Animation Component
function CoinFlip({ isSigning, isFlipping, result, onComplete, transactionSignature, recipient, amount }: {
  isSigning: boolean
  isFlipping: boolean
  result: 'heads' | 'tails' | null
  onComplete: () => void
  transactionSignature?: string
  recipient?: string
  amount?: string
}) {
  const [showResult, setShowResult] = useState(false)

  useEffect(() => {
    if (result && !showResult) {
      setTimeout(() => {
        setShowResult(true)
        // Don't auto-close anymore, let user close manually
      }, 3000) // 3 second animation
    }
  }, [result, showResult, onComplete])

  // Reset showResult when component starts fresh (new game)
  useEffect(() => {
    if (isSigning && !isFlipping && !result) {
      setShowResult(false)
    }
  }, [isSigning, isFlipping, result])

  if (!isSigning && !isFlipping && !result) return null

  const formatAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`
  }

  const openInExplorer = () => {
    if (transactionSignature) {
      window.open(`https://explorer.solana.com/tx/${transactionSignature}?cluster=devnet`, '_blank')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl p-8 text-center shadow-2xl max-w-md w-full">
        {/* Coin Animation */}
        <div className="coin-container mb-6">
          <div className={`coin ${isFlipping ? 'flipping' : showResult ? (result === 'heads' ? 'show-heads' : 'show-tails') : ''}`}>
            <div className="coin-face heads">H</div>
            <div className="coin-face tails">T</div>
          </div>
        </div>

        {/* Status Message */}
        <div className="text-xl font-semibold text-gray-800 mb-4">
          {isSigning ? 'Signing transaction...' : isFlipping ? 'Flipping...' : showResult ? `${result?.toUpperCase()}!` : ''}
        </div>

        {/* Game Result */}
        {showResult && (
          <div className="mb-6">
            <div className={`text-lg font-semibold mb-2 ${result === 'heads' ? 'text-green-600' : 'text-red-600'}`}>
              {result === 'heads' ? '🎉 You Won! Payment sent for FREE!' : `😔 You Lost. Payment cost 2x (${(parseFloat(amount || '0') * 2).toFixed(3)} SOL)`}
            </div>
          </div>
        )}

        {/* Payment Details */}
        {showResult && (
          <div className="bg-gray-50 rounded-2xl p-4 mb-6 text-left">
            <div className="text-sm font-semibold text-gray-700 mb-3">Payment Details</div>

            {recipient && (
              <div className="flex justify-between items-center py-2 border-b border-gray-200">
                <span className="text-sm text-gray-600">To:</span>
                <span className="text-sm font-mono text-gray-800">{formatAddress(recipient)}</span>
              </div>
            )}

            {amount && (
              <div className="flex justify-between items-center py-2 border-b border-gray-200">
                <span className="text-sm text-gray-600">Amount:</span>
                <span className="text-sm font-semibold text-gray-800 flex items-center gap-1">
                  <img src="/solana.png" alt="SOL" className="w-3 h-3" />
                  {amount}
                </span>
              </div>
            )}

            {transactionSignature && (
              <div className="flex justify-between items-center py-2">
                <span className="text-sm text-gray-600">Transaction:</span>
                <span className="text-sm font-mono text-gray-800">{formatAddress(transactionSignature)}</span>
              </div>
            )}

            <div className="flex justify-between items-center py-2 border-t border-gray-200 mt-2">
              <span className="text-sm text-gray-600">Status:</span>
              <span className="text-sm font-semibold text-green-600">✓ Confirmed</span>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        {showResult && (
          <div className="space-y-3">
            {transactionSignature && (
              <button
                onClick={openInExplorer}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-all duration-200 flex items-center justify-center gap-2"
              >
                <span>View in Explorer</span>
                <span>↗</span>
              </button>
            )}

            <button
              onClick={onComplete}
              className="w-full bg-gray-600 hover:bg-gray-700 text-white font-semibold py-3 rounded-lg transition-all duration-200"
            >
              Close
            </button>
          </div>
        )}
      </div>

        <style jsx>{`
          .coin-container {
            perspective: 1000px;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 120px;
          }

          .coin {
            width: 80px;
            height: 80px;
            position: relative;
            transform-style: preserve-3d;
            border-radius: 50%;
          }

          .coin-face {
            position: absolute;
            width: 100%;
            height: 100%;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 32px;
            font-weight: bold;
            color: white;
            backface-visibility: hidden;
            border: 3px solid #ffd700;
            box-shadow: 0 0 20px rgba(255, 215, 0, 0.5);
          }

          .heads {
            background: linear-gradient(45deg, #ffd700, #ffed4e);
            color: #8b4513;
          }

          .tails {
            background: linear-gradient(45deg, #c0c0c0, #e5e5e5);
            color: #4a4a4a;
            transform: rotateY(180deg);
          }

          .flipping {
            animation: spin 3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
          }

          .show-heads {
            transform: rotateY(0deg);
            transition: transform 0.6s ease-out;
          }

          .show-tails {
            transform: rotateY(180deg);
            transition: transform 0.6s ease-out;
          }

          @keyframes spin {
            0% {
              transform: rotateY(0deg) rotateX(0deg);
            }
            25% {
              transform: rotateY(900deg) rotateX(180deg) scale(1.2);
            }
            50% {
              transform: rotateY(1800deg) rotateX(360deg) scale(1.1);
            }
            75% {
              transform: rotateY(2700deg) rotateX(540deg) scale(1.2);
            }
            100% {
              transform: rotateY(3600deg) rotateX(720deg);
            }
          }
        `}</style>
      </div>
  )
}

export default function LuckPayGameAddictive() {
  const { publicKey } = useWallet()
  const { connection } = useConnection()
  const luckPay = useLuckPaySimple()

  const [balance, setBalance] = useState<number>(0)
  const [amount, setAmount] = useState('0.05')
  const [recipient, setRecipient] = useState('')
  const [isPlaying, setIsPlaying] = useState(false)
  const [isSigning, setIsSigning] = useState(false)
  const [isFlipping, setIsFlipping] = useState(false)
  const [flipResult, setFlipResult] = useState<'heads' | 'tails' | null>(null)
  const [recipientError, setRecipientError] = useState('')
  const [isValidatingAddress, setIsValidatingAddress] = useState(false)
  const [resolvedAddress, setResolvedAddress] = useState('')
  const [transactionSignature, setTransactionSignature] = useState('')
  const [showQRScanner, setShowQRScanner] = useState(false)
  const [amountError, setAmountError] = useState('')

  // Fetch balance when wallet connects
  useEffect(() => {
    if (publicKey && connection) {
      const fetchBalance = async () => {
        try {
          const bal = await connection.getBalance(publicKey)
          setBalance(bal / LAMPORTS_PER_SOL)
        } catch (error) {
          console.error('Error fetching balance:', error)
        }
      }
      fetchBalance()
    }
  }, [publicKey, connection])

  // Validate and resolve address/domain
  const validateRecipient = async (input: string) => {
    if (!input.trim()) {
      setRecipientError('')
      setResolvedAddress('')
      return null
    }

    setIsValidatingAddress(true)
    setRecipientError('')

    try {
      // Check if it's a .sol domain
      if (input.endsWith('.sol')) {
        try {
          const resolvedPubkey = await resolve(connection, input)
          setResolvedAddress(resolvedPubkey.toBase58())
          setRecipientError('')
          return resolvedPubkey
        } catch (error) {
          setRecipientError('Invalid .sol domain or domain not found')
          setResolvedAddress('')
          return null
        }
      } else {
        // Try to parse as PublicKey
        try {
          const pubkey = new PublicKey(input.trim())
          setResolvedAddress(pubkey.toBase58())
          setRecipientError('')
          return pubkey
        } catch (error) {
          setRecipientError('Invalid wallet address format')
          setResolvedAddress('')
          return null
        }
      }
    } catch (error) {
      setRecipientError('Failed to validate address')
      setResolvedAddress('')
      return null
    } finally {
      setIsValidatingAddress(false)
    }
  }

  // Handle recipient input change with debounced validation
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (recipient.trim()) {
        validateRecipient(recipient)
      } else {
        setRecipientError('')
        setResolvedAddress('')
      }
    }, 500) // 500ms delay

    return () => clearTimeout(timeoutId)
  }, [recipient, connection])

  // Validate amount
  const validateAmount = (value: string) => {
    if (!value.trim()) {
      setAmountError('')
      return
    }

    const amountFloat = parseFloat(value)

    if (isNaN(amountFloat) || amountFloat <= 0) {
      setAmountError('Amount must be greater than 0')
      return
    }

    const lockAmount = amountFloat * 2 // Need to lock 2x the send amount
    const maxAffordable = balance / 2 // Maximum we can send (since we need 2x in total)

    if (lockAmount > balance) {
      setAmountError(`Insufficient balance. Max sendable: ${maxAffordable.toFixed(4)} SOL`)
      return
    }

    // Additional buffer for transaction fees
    const feeBuffer = 0.01 // 0.01 SOL buffer for fees
    if (lockAmount > (balance - feeBuffer)) {
      setAmountError(`Amount too high. Leave buffer for fees. Max: ${Math.max(0, (balance - feeBuffer) / 2).toFixed(4)} SOL`)
      return
    }

    setAmountError('')
  }

  // Handle amount input change with debounced validation
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      validateAmount(amount)
    }, 300) // 300ms delay

    return () => clearTimeout(timeoutId)
  }, [amount, balance])

  // Handle QR code scan result
  const handleQRScan = (result: string) => {
    setRecipient(result.trim())
    setShowQRScanner(false)
    toast.success('Address scanned successfully!')
  }

  const handleFlipAndSend = async () => {
    if (!publicKey) {
      toast.error('Please connect your wallet first')
      return
    }

    if (!recipient.trim()) {
      toast.error('Please enter a recipient address')
      return
    }

    if (recipientError) {
      toast.error('Please fix the recipient address error')
      return
    }

    if (amountError) {
      toast.error('Please fix the amount error')
      return
    }

    const amountFloat = parseFloat(amount)
    if (!amountFloat || amountFloat <= 0) {
      toast.error('Please enter a valid amount')
      return
    }

    // Get validated recipient address
    const recipientPubkey = await validateRecipient(recipient)
    if (!recipientPubkey) {
      toast.error('Invalid recipient address')
      return
    }

    try {
      // Clear previous state
      setFlipResult(null)
      setTransactionSignature('')

      setIsPlaying(true)
      setIsSigning(true)

      const betAmountLamports = amountFloat * LAMPORTS_PER_SOL

      // Start the game - this will show "Signing transaction..." first
      const result = await luckPay.playGame(
        betAmountLamports,
        recipientPubkey,
        'heads', // Always heads for simplicity
        100 // Max risk
      )

      // Store transaction signature for explorer link
      setTransactionSignature(result.signature || '')

      // Once signed and confirmed, start the coin flip animation
      setIsSigning(false)
      setIsFlipping(true)

      // Show coin flip animation for 3 seconds, then show result
      setTimeout(() => {
        setIsFlipping(false)
        setFlipResult(result.result.coinResult as 'heads' | 'tails')
      }, 3000)

    } catch (error: any) {
      console.error('Game error:', error)
      toast.error(error.message || 'Transaction failed')
      setIsPlaying(false)
      setIsSigning(false)
      setIsFlipping(false)
    }
  }

  const handleFlipComplete = () => {
    if (!flipResult) return

    // Reset for next game
    setIsPlaying(false)
    setIsSigning(false)
    setIsFlipping(false)
    setFlipResult(null)
    setTransactionSignature('')

    // Refresh balance
    if (publicKey && connection) {
      setTimeout(async () => {
        const bal = await connection.getBalance(publicKey)
        setBalance(bal / LAMPORTS_PER_SOL)
      }, 1000)
    }
  }

  const formatAddress = (address: string) => {
    return `${address.slice(0, 3)}...${address.slice(-3)}`
  }

  const lockAmount = parseFloat(amount) * 2

  return (
    <div className="min-h-screen bg-[#1a1a2e] text-white flex items-center justify-center p-4">
      <Toaster position="top-center" />

      <div className="w-full max-w-md">
        {/* Phantom-style container */}
        <div className="bg-[#2d2d3a] rounded-2xl p-6 shadow-2xl border border-gray-700">

          {!publicKey ? (
            // Pre-connection state
            <div className="text-center space-y-6">
              <div className="w-16 h-16 bg-purple-600 rounded-full mx-auto flex items-center justify-center text-2xl">
                🎲
              </div>

              <div>
                <h1 className="text-2xl font-bold mb-2">LuckPay</h1>
                <p className="text-gray-400 text-sm leading-relaxed">
                  Send money the fun way:<br />
                  50% chance you pay nothing.<br />
                  If you lose, the payment still goes through.
                </p>
              </div>

              <WalletMultiButton className="!bg-purple-600 hover:!bg-purple-700 !rounded-xl !font-semibold !py-3 !px-6 !text-sm !transition-all" />
            </div>
          ) : (
            // Connected state
            <div className="space-y-6">
              {/* Wallet info */}
              <div className="flex items-center justify-between pb-4 border-b border-gray-600">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-sm">
                    ✓
                  </div>
                  <span className="text-sm font-medium">Wallet Connected</span>
                </div>
                <WalletMultiButton className="!bg-red-600 hover:!bg-red-700 !text-white !text-xs !py-2 !px-3 !rounded-lg !font-medium" />
              </div>

              <div>
                <div className="text-sm text-gray-400 mb-1">Address:</div>
                <div className="font-mono text-sm">{formatAddress(publicKey.toBase58())}</div>
              </div>

              <div>
                <div className="text-sm text-gray-400 mb-1">Balance</div>
                <div className="text-lg font-semibold flex items-center gap-2">
                  <img src="/solana.png" alt="SOL" className="w-5 h-5" />
                  {balance.toFixed(3)}
                </div>
              </div>

              <hr className="border-gray-600" />

              {/* Game interface */}
              <div>
                <p className="text-center text-sm text-gray-300 mb-6 leading-relaxed">
                  Send money the fun way:<br />
                  50% chance you pay nothing.<br />
                  If you lose, the payment still goes through.
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Amount to send:</label>
                    <div className="relative">
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        step="0.01"
                        min="0"
                        disabled={isPlaying}
                        className={`w-full bg-[#1a1a2e] border rounded-lg px-4 py-3 text-white focus:ring-1 outline-none transition-colors ${
                          amountError
                            ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                            : 'border-gray-600 focus:border-purple-500 focus:ring-purple-500'
                        }`}
                        placeholder="0.05"
                      />
                      <div className="absolute right-3 top-3 flex items-center gap-1">
                        <img src="/solana.png" alt="SOL" className="w-4 h-4" />
                        <span className="text-gray-400 text-sm">SOL</span>
                      </div>
                    </div>

                    {amountError && (
                      <div className="mt-1 text-xs text-red-400">
                        {amountError}
                      </div>
                    )}

                    {!amountError && balance > 0 && (
                      <div className="mt-1 text-xs text-gray-500">
                        Max sendable: <span className="text-gray-300">{(balance / 2).toFixed(4)} SOL</span>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Receiver:</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                        disabled={isPlaying}
                        className={`w-full bg-[#1a1a2e] border rounded-lg px-4 py-3 text-white focus:ring-1 outline-none text-sm transition-colors ${
                          recipientError
                            ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                            : resolvedAddress
                              ? 'border-green-500 focus:border-green-500 focus:ring-green-500'
                              : 'border-gray-600 focus:border-purple-500 focus:ring-purple-500'
                        }`}
                        placeholder="bob.sol or wallet address"
                      />
                      {/* QR Scanner Button */}
                      <button
                        type="button"
                        onClick={() => setShowQRScanner(true)}
                        disabled={isPlaying}
                        className="absolute right-8 top-3 p-1 hover:opacity-75 transition-opacity disabled:opacity-50"
                        title="Scan QR Code"
                      >
                        <img src="/qr-code.png" alt="Scan QR" className="w-4 h-4" />
                      </button>

                      {isValidatingAddress && (
                        <div className="absolute right-3 top-3">
                          <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                        </div>
                      )}
                      {resolvedAddress && !isValidatingAddress && (
                        <div className="absolute right-3 top-3 text-green-500 text-sm">
                          ✓
                        </div>
                      )}
                      {recipientError && !isValidatingAddress && (
                        <div className="absolute right-3 top-3 text-red-500 text-sm">
                          ✗
                        </div>
                      )}
                    </div>

                    {recipientError && (
                      <div className="mt-1 text-xs text-red-400">
                        {recipientError}
                      </div>
                    )}

                    {resolvedAddress && !recipientError && recipient.endsWith('.sol') && (
                      <div className="mt-1 text-xs text-green-400">
                        Resolves to: {formatAddress(resolvedAddress)}
                      </div>
                    )}
                  </div>

                  {amount && parseFloat(amount) > 0 && (
                    <div className="bg-yellow-900/30 border border-yellow-600/50 rounded-lg p-3">
                      <div className="text-sm text-yellow-200 flex items-center gap-1">
                        You will lock:
                        <span className="font-semibold flex items-center gap-1">
                          <img src="/solana.png" alt="SOL" className="w-3 h-3" />
                          {lockAmount.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleFlipAndSend}
                    disabled={!recipient.trim() || !amount || parseFloat(amount) <= 0 || isPlaying || !!recipientError || isValidatingAddress || !!amountError}
                    className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-lg transition-all duration-200 transform hover:scale-[1.02] disabled:hover:scale-100"
                  >
                    {isPlaying ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        {isSigning ? 'Signing...' : 'Playing...'}
                      </span>
                    ) : (
                      'Flip & Send'
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <CoinFlip
        isSigning={isSigning}
        isFlipping={isFlipping}
        result={flipResult}
        onComplete={handleFlipComplete}
        transactionSignature={transactionSignature}
        recipient={resolvedAddress || recipient}
        amount={amount}
      />

      <QRScanner
        isOpen={showQRScanner}
        onClose={() => setShowQRScanner(false)}
        onScan={handleQRScan}
      />
    </div>
  )
}