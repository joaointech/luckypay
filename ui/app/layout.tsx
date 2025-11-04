import type { Metadata } from 'next'
import './globals.css'
import { WalletContextProvider } from './components/WalletContextProvider'

export const metadata: Metadata = {
  title: 'LuckPay - Provably Fair Coin Flip',
  description: 'Send SOL with a coin flip chance - win and send for free, lose and pay double',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <WalletContextProvider>
          {children}
        </WalletContextProvider>
      </body>
    </html>
  )
}