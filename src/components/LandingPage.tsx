import { motion } from 'framer-motion';
import { ArrowRight, ArrowLeftRight, RefreshCw, Droplets, Layers, Shield, Zap, Globe } from 'lucide-react';

interface LandingPageProps {
  onGetStarted: () => void;
}

export default function LandingPage({ onGetStarted }: LandingPageProps) {
  const features = [
    {
      icon: ArrowLeftRight,
      title: 'Cross-Chain Bridge',
      description: 'Seamlessly bridge USDC between Ethereum Sepolia and Arc Testnet',
      color: 'from-orange-500 to-emerald-500',
    },
    {
      icon: RefreshCw,
      title: 'Token Swap',
      description: 'Swap tokens on Arc Testnet with Uniswap V2 style interface',
      color: 'from-orange-500 to-emerald-500',
    },
    {
      icon: Droplets,
      title: 'Liquidity Provision',
      description: 'Add liquidity to pools on Arc Testnet and earn trading fees',
      color: 'from-orange-500 to-emerald-500',
    },
    {
      icon: Layers,
      title: 'Pool Management',
      description: 'Browse and manage your liquidity positions on Arc Testnet',
      color: 'from-orange-500 to-emerald-500',
    },
  ];

  const benefits = [
    { icon: Zap, text: 'Lightning Fast Transactions' },
    { icon: Shield, text: 'Secure & Trustless' },
    { icon: Globe, text: 'Cross-Chain Interoperability' },
  ];

  return (
    <div className="min-h-screen bg-orange-50 relative overflow-hidden">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute top-20 left-10 w-72 h-72 bg-orange-300/20 rounded-full blur-3xl"
          animate={{
            x: [0, 100, 0],
            y: [0, 50, 0],
            scale: [1, 1.2, 1],
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
        <motion.div
          className="absolute bottom-20 right-10 w-96 h-96 bg-emerald-300/20 rounded-full blur-3xl"
          animate={{
            x: [0, -100, 0],
            y: [0, -50, 0],
            scale: [1, 1.3, 1],
          }}
          transition={{
            duration: 25,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      </div>

      <div className="relative z-10 container mx-auto px-3 sm:px-4 py-8 sm:py-12 md:py-16">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-8 sm:mb-12 md:mb-16"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            className="inline-flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-white rounded-full border border-gray-200 shadow-lg mb-4 sm:mb-6"
          >
            <span className="text-xs sm:text-sm font-semibold text-gray-700">Powered by Arc Testnet</span>
          </motion.div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-gray-900 mb-4 sm:mb-6">
            DeFi On ARC
          </h1>

          <p className="text-base sm:text-lg md:text-xl lg:text-2xl text-gray-600 max-w-3xl mx-auto mb-6 sm:mb-8 px-4">
            Cross-chain bridge between Sepolia and Arc Testnet, plus DeFi tools exclusively on Arc Testnet
          </p>
        </motion.div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8 sm:mb-12 md:mb-16">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + index * 0.1 }}
                className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 border border-gray-200 shadow-xl hover:shadow-2xl transition-all cursor-pointer group relative overflow-hidden"
                whileHover={{ scale: 1.05, y: -5 }}
                style={{
                  boxShadow: `
                    inset 0 1px 0 rgba(255, 255, 255, 0.8),
                    inset 0 -1px 0 rgba(0, 0, 0, 0.1),
                    0 20px 40px rgba(0, 0, 0, 0.1),
                    0 8px 16px rgba(0, 0, 0, 0.08)
                  `
                }}
              >
                <div className="relative z-10">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-orange-500 flex items-center justify-center mb-3 sm:mb-4 shadow-lg">
                    <Icon className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
                  </div>
                  <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-2">{feature.title}</h3>
                  <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">{feature.description}</p>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Token Exchange Animation - Rectangular Loop */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.6 }}
          className="flex justify-center my-8 sm:my-12 md:my-16"
        >
          <div className="relative w-full max-w-xl h-40 sm:h-52 md:h-64">
            {/* Rectangular path indicator */}
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 500 320">
              <rect
                x="30"
                y="30"
                width="440"
                height="260"
                rx="16"
                fill="none"
                stroke="rgba(251, 146, 60, 0.15)"
                strokeWidth="2"
                strokeDasharray="6 6"
              />
            </svg>

            {/* Token 1: USDC - starts top-left, moves to top-right position */}
            <motion.div
              className="absolute"
              style={{
                left: '15px',
                top: '15px',
              }}
              animate={{
                x: [0, 'calc(100% - 30px)', 'calc(100% - 30px)', 0, 0],
                y: [0, 0, 'calc(100% - 30px)', 'calc(100% - 30px)', 0],
              }}
              transition={{
                duration: 6,
                repeat: Infinity,
                ease: 'linear',
              }}
            >
              <motion.div
                className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white border-2 border-orange-200 shadow-lg flex items-center justify-center p-1.5"
                style={{
                  boxShadow: `
                    inset 0 1px 2px rgba(255, 255, 255, 0.8),
                    inset 0 -1px 2px rgba(0, 0, 0, 0.1),
                    0 4px 8px rgba(251, 146, 60, 0.2),
                    0 2px 4px rgba(0, 0, 0, 0.05)
                  `,
                }}
              >
                <img src="/usdc.svg" alt="USDC" className="w-full h-full object-contain" />
              </motion.div>
            </motion.div>

            {/* Token 2: SRAC - starts top-right, moves to bottom-right position (1.5s delay) */}
            <motion.div
              className="absolute"
              style={{
                right: '15px',
                top: '15px',
              }}
              animate={{
                x: [0, 0, 'calc(-100% + 30px)', 'calc(-100% + 30px)', 0],
                y: [0, 'calc(100% - 30px)', 'calc(100% - 30px)', 0, 0],
              }}
              transition={{
                duration: 6,
                repeat: Infinity,
                ease: 'linear',
                delay: 1.5,
              }}
            >
              <motion.div
                className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white border-2 border-emerald-200 shadow-lg flex items-center justify-center p-1.5"
                style={{
                  boxShadow: `
                    inset 0 1px 2px rgba(255, 255, 255, 0.8),
                    inset 0 -1px 2px rgba(0, 0, 0, 0.1),
                    0 4px 8px rgba(16, 185, 129, 0.2),
                    0 2px 4px rgba(0, 0, 0, 0.05)
                  `,
                }}
              >
                <img src="/srac.png" alt="SRAC" className="w-full h-full object-contain" />
              </motion.div>
            </motion.div>

            {/* Token 3: RACS - starts bottom-right, moves to bottom-left position (3s delay) */}
            <motion.div
              className="absolute"
              style={{
                right: '15px',
                bottom: '15px',
              }}
              animate={{
                x: [0, 'calc(-100% + 30px)', 'calc(-100% + 30px)', 0, 0],
                y: [0, 0, 'calc(-100% + 30px)', 'calc(-100% + 30px)', 0],
              }}
              transition={{
                duration: 6,
                repeat: Infinity,
                ease: 'linear',
                delay: 3,
              }}
            >
              <motion.div
                className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white border-2 border-orange-300 shadow-lg flex items-center justify-center p-1.5"
                style={{
                  boxShadow: `
                    inset 0 1px 2px rgba(255, 255, 255, 0.8),
                    inset 0 -1px 2px rgba(0, 0, 0, 0.1),
                    0 4px 8px rgba(251, 146, 60, 0.2),
                    0 2px 4px rgba(0, 0, 0, 0.05)
                  `,
                }}
              >
                <img src="/racs.png" alt="RACS" className="w-full h-full object-contain" />
              </motion.div>
            </motion.div>

            {/* Token 4: SACS - starts bottom-left, moves to top-left position (4.5s delay) */}
            <motion.div
              className="absolute"
              style={{
                left: '15px',
                bottom: '15px',
              }}
              animate={{
                x: [0, 0, 'calc(100% - 30px)', 'calc(100% - 30px)', 0],
                y: [0, 'calc(-100% + 30px)', 'calc(-100% + 30px)', 0, 0],
              }}
              transition={{
                duration: 6,
                repeat: Infinity,
                ease: 'linear',
                delay: 4.5,
              }}
            >
              <motion.div
                className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white border-2 border-emerald-300 shadow-lg flex items-center justify-center p-1.5"
                style={{
                  boxShadow: `
                    inset 0 1px 2px rgba(255, 255, 255, 0.8),
                    inset 0 -1px 2px rgba(0, 0, 0, 0.1),
                    0 4px 8px rgba(16, 185, 129, 0.2),
                    0 2px 4px rgba(0, 0, 0, 0.05)
                  `,
                }}
              >
                <img src="/sacs.png" alt="SACS" className="w-full h-full object-contain" />
              </motion.div>
            </motion.div>

            {/* Exchange arrows at midpoints */}
            <motion.div
              className="absolute top-1 left-1/2 -translate-x-1/2"
              animate={{ x: [0, 4, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            >
              <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 text-orange-400 opacity-70" />
            </motion.div>
            <motion.div
              className="absolute top-1/2 right-1 -translate-y-1/2"
              animate={{ y: [0, 4, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut', delay: 0.25 }}
            >
              <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 text-orange-400 opacity-70 rotate-90" />
            </motion.div>
            <motion.div
              className="absolute bottom-1 left-1/2 -translate-x-1/2"
              animate={{ x: [0, -4, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
            >
              <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 text-orange-400 opacity-70 rotate-180" />
            </motion.div>
            <motion.div
              className="absolute top-1/2 left-1 -translate-y-1/2"
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut', delay: 0.75 }}
            >
              <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 text-orange-400 opacity-70 -rotate-90" />
            </motion.div>
          </div>
        </motion.div>

        {/* Benefits Section */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="bg-white rounded-2xl sm:rounded-3xl p-6 sm:p-8 border border-gray-200 shadow-2xl max-w-4xl mx-auto"
          style={{
            boxShadow: `
              inset 0 1px 0 rgba(255, 255, 255, 0.8),
              inset 0 -1px 0 rgba(0, 0, 0, 0.1),
              0 20px 40px rgba(0, 0, 0, 0.1),
              0 8px 16px rgba(0, 0, 0, 0.08)
            `
          }}
        >
          <div className="text-center mb-6 sm:mb-8">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3 sm:mb-4">
              Why Choose Our Platform?
            </h2>
            <p className="text-sm sm:text-base text-gray-600">
              Bridge assets between chains, then use DeFi tools on Arc Testnet
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
            {benefits.map((benefit, index) => {
              const Icon = benefit.icon;
              return (
                <motion.div
                  key={benefit.text}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.8 + index * 0.1 }}
                  className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 bg-orange-50 rounded-xl border border-orange-200"
                >
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl bg-orange-500 flex items-center justify-center flex-shrink-0 shadow-lg">
                    <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                  </div>
                  <span className="text-sm sm:text-base font-semibold text-gray-900">{benefit.text}</span>
                </motion.div>
              );
            })}
          </div>
        </motion.div>

        {/* CTA Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1 }}
          className="text-center mt-8 sm:mt-12 md:mt-16"
        >
          <h3 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3 sm:mb-4">
            Ready to Start?
          </h3>
          <p className="text-sm sm:text-base text-gray-600 mb-4 sm:mb-6 px-4">
            Connect your wallet and explore the full DeFi experience
          </p>
          <motion.button
            onClick={onGetStarted}
            className="px-6 sm:px-8 py-3 sm:py-4 bg-orange-500 text-white rounded-xl font-bold text-base sm:text-lg shadow-lg hover:bg-orange-600 hover:shadow-2xl transition-all duration-300 inline-flex items-center gap-2"
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.98 }}
          >
            <span>Launch App</span>
            <ArrowRight className="w-5 h-5" />
          </motion.button>
        </motion.div>
      </div>
    </div>
  );
}

