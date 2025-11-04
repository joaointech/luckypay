'use client'

import React, { useState, useCallback, useEffect } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import toast, { Toaster } from 'react-hot-toast'
import { useLuckPaySimple } from '../hooks/useLuckPaySimple'

interface ThemeContextType {
  isDark: boolean
  toggleTheme: () => void
}

const ThemeContext = React.createContext<ThemeContextType>({
  isDark: true,
  toggleTheme: () => {}
})

function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(true)

  const toggleTheme = useCallback(() => {
    setIsDark(prev => !prev)
  }, [])

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [isDark])

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

function ThemeToggle() {
  const { isDark, toggleTheme } = React.useContext(ThemeContext)

  return (
    <button
      onClick={toggleTheme}
      className="fixed top-4 right-4 p-2 rounded-full bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 transition-all z-50 shadow-lg"
      aria-label="Toggle theme"
    >
      {isDark ? '☀️' : '🌙'}
    </button>
  )
}

function QuickCoinFlip({
  isFlipping,
  result,
  onComplete
}: {
  isFlipping: boolean
  result: 'heads' | 'tails' | null
  onComplete: () => void
}) {
  const [showResult, setShowResult] = useState(false)

  useEffect(() => {
    if (result && !showResult) {
      setTimeout(() => {
        setShowResult(true)
        setTimeout(onComplete, 1000)
      }, 500)
    }
  }, [result, showResult, onComplete])

  if (!isFlipping && !result) return null

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 text-center shadow-2xl">
        <div className={`text-6xl mb-4 transition-transform duration-500 ${
          isFlipping ? 'animate-spin' : showResult ? 'scale-110' : ''
        }`}>
          {isFlipping ? '🪙' : (result === 'heads' ? '🪙' : '🎯')}
        </div>
        <div className="text-xl font-bold text-gray-900 dark:text-white">
          {isFlipping ? 'Flipping...' : showResult ? result?.toUpperCase() : ''}
        </div>
      </div>
    </div>
  )
}

function StatsDisplay({
  wins,
  losses,
  streak,
  totalSaved
}: {
  wins: number
  losses: number
  streak: number
  totalSaved: number
}) {
  return (
    <div className="grid grid-cols-2 gap-4 mb-6">
      <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-center">
        <div className="text-2xl font-bold text-green-600 dark:text-green-400">{wins}</div>
        <div className="text-xs text-green-700 dark:text-green-300">Wins</div>
      </div>
      <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 text-center">
        <div className="text-2xl font-bold text-red-600 dark:text-red-400">{losses}</div>
        <div className="text-xs text-red-700 dark:text-red-300">Losses</div>
      </div>
      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-center">
        <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{streak}</div>
        <div className="text-xs text-blue-700 dark:text-blue-300">Streak</div>
      </div>
      <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3 text-center">
        <div className="text-lg font-bold text-purple-600 dark:text-purple-400">
          {totalSaved.toFixed(2)}
        </div>
        <div className="text-xs text-purple-700 dark:text-purple-300">SOL Saved</div>
      </div>
    </div>
  )
}

function GameCard() {
  const { publicKey } = useWallet()
  const luckPay = useLuckPaySimple()
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('0.1')
  const [choice, setChoice] = useState<'heads' | 'tails'>('heads')
  const [isPlaying, setIsPlaying] = useState(false)
  const [isFlipping, setIsFlipping] = useState(false)
  const [flipResult, setFlipResult] = useState<'heads' | 'tails' | null>(null)

  // Stats
  const [wins, setWins] = useState(0)
  const [losses, setLosses] = useState(0)
  const [streak, setStreak] = useState(0)
  const [totalSaved, setTotalSaved] = useState(0)

  const handleFlipComplete = useCallback(() => {
    setIsFlipping(false)
    setFlipResult(null)
  }, [])

  const playGame = useCallback(async () => {
    if (!luckPay.publicKey || !amount || !recipient) {
      toast.error('Fill all fields!')
      return
    }

    let recipientPubkey: PublicKey
    try {
      recipientPubkey = new PublicKey(recipient)
    } catch {
      toast.error('Invalid wallet address')
      return
    }

    if (recipientPubkey.equals(luckPay.publicKey)) {
      toast.error('Cannot send to yourself!')
      return
    }

    setIsPlaying(true)
    setIsFlipping(true)
    setFlipResult(null)

    try {
      const betAmount = parseFloat(amount) * LAMPORTS_PER_SOL
      const result = await luckPay.playGame(betAmount, recipientPubkey, choice, 100, 2)

      // Show result after a quick delay
      setTimeout(() => {
        setFlipResult(result.result.coinResult)

        const actuallyWon = result.result.coinResult.toLowerCase() === choice.toLowerCase()

        if (actuallyWon) {
          setWins(w => w + 1)
          setStreak(s => s + 1)
          setTotalSaved(t => t + parseFloat(amount))
          toast.success(`🎉 FREE TRANSFER!`, { duration: 3000 })
        } else {
          setLosses(l => l + 1)
          setStreak(0)
          toast.error(`💸 Paid ${(parseFloat(amount) * 2).toFixed(2)} SOL`, { duration: 3000 })
        }
      }, 300)

    } catch (error: any) {
      setIsFlipping(false)
      console.error('Game error:', error)
      toast.error('Game failed!')
    } finally {
      setIsPlaying(false)
    }
  }, [luckPay, amount, recipient, choice])

  const quickAmounts = ['0.05', '0.1', '0.25', '0.5']

  return (
    <div className="max-w-sm mx-auto">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-500 to-pink-500 p-6 text-center">
          <h1 className="text-2xl font-bold text-white mb-1">⚡ LuckPay</h1>
          <p className="text-purple-100 text-sm">Double or FREE!</p>
        </div>

        <div className="p-6">
          {!publicKey ? (
            <div className="text-center py-8">
              <WalletMultiButton />
            </div>
          ) : (
            <>
              {/* Stats */}
              <StatsDisplay
                wins={wins}
                losses={losses}
                streak={streak}
                totalSaved={totalSaved}
              />

              {/* Quick Amount Selection */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Amount (SOL)
                </label>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {quickAmounts.map((amt) => (
                    <button
                      key={amt}
                      onClick={() => setAmount(amt)}
                      className={`p-2 rounded-lg text-sm font-medium transition-all ${
                        amount === amt
                          ? 'bg-purple-500 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      {amt}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  step="0.01"
                  min="0.01"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-center text-lg font-mono"
                />
              </div>

              {/* Recipient */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Send To
                </label>
                <input
                  type="text"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="Wallet address..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                />
              </div>

              {/* Coin Choice */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Your Call
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setChoice('heads')}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      choice === 'heads'
                        ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20 scale-105'
                        : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                    }`}
                  >
                    <div className="text-3xl mb-1">🪙</div>
                    <div className="font-medium text-gray-900 dark:text-white">Heads</div>
                  </button>
                  <button
                    onClick={() => setChoice('tails')}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      choice === 'tails'
                        ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20 scale-105'
                        : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                    }`}
                  >
                    <div className="text-3xl mb-1">🎯</div>
                    <div className="font-medium text-gray-900 dark:text-white">Tails</div>
                  </button>
                </div>
              </div>

              {/* Game Info */}
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 mb-6 text-center">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Win: <span className="text-green-600 dark:text-green-400 font-bold">FREE</span> •
                  Lose: <span className="text-red-600 dark:text-red-400 font-bold">{(parseFloat(amount || '0') * 2).toFixed(2)} SOL</span>
                </div>
              </div>

              {/* Play Button */}
              <button
                onClick={playGame}
                disabled={isPlaying || !amount || !recipient}
                className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:from-gray-400 disabled:to-gray-400 text-white font-bold py-4 px-4 rounded-xl transition-all disabled:cursor-not-allowed transform hover:scale-105 disabled:hover:scale-100 shadow-lg"
              >
                {isPlaying ? (
                  <div className="flex items-center justify-center space-x-2">
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                    <span>Flipping...</span>
                  </div>
                ) : (
                  `🎲 FLIP FOR ${amount || '0'} SOL`
                )}
              </button>
            </>
          )}
        </div>
      </div>

      <QuickCoinFlip
        isFlipping={isFlipping && !flipResult}
        result={flipResult}
        onComplete={handleFlipComplete}
      />
    </div>
  )
}

export default function LuckPayGameAddictive() {
  return (
    <ThemeProvider>
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4 transition-colors">
        <Toaster
          position="top-center"
          toastOptions={{
            duration: 2000,
            style: {
              background: 'var(--toast-bg)',
              color: 'var(--toast-color)',
            },
          }}
        />
        <ThemeToggle />
        <GameCard />
      </div>
    </ThemeProvider>
  )
}