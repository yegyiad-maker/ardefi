import { useEffect, useRef, useState } from 'react';
import { AreaSeries, createChart, ColorType, type ISeriesApi } from 'lightweight-charts';
import { usePriceHistory, type PriceDataPoint } from '../hooks/usePriceHistory';
import { type TokenSymbol } from '../hooks/useDEX';
import { type Address } from 'viem';
import { Loader2 } from 'lucide-react';

interface PriceChartProps {
  fromToken: TokenSymbol;
  toToken: TokenSymbol;
  poolAddress: Address | null;
  height?: number;
}

export default function PriceChart({
  fromToken,
  toToken,
  poolAddress,
  height = 300,
}: PriceChartProps) {
  const [timeRange, setTimeRange] = useState<'1H' | '1D' | '1W' | '1M'>('1D');
  const [chartReady, setChartReady] = useState(false);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  
  const { priceData, isLoading, error } = usePriceHistory(fromToken, toToken, poolAddress, timeRange);

  // Initialize chart when container becomes available
  // This effect needs to run whenever the container might become available
  useEffect(() => {
    // Don't initialize if we don't have required props
    if (!poolAddress || isLoading || error) {
      return;
    }

    // If chart already exists, just mark it ready
    if (chartRef.current && seriesRef.current) {
      setChartReady(true);
      return;
    }

    let handleResize: (() => void) | null = null;
    let timeoutId: NodeJS.Timeout | null = null;
    let retryCount = 0;
    const MAX_RETRIES = 10;

    // Wait for container to be available
    const initChart = () => {
      if (!chartContainerRef.current) {
        retryCount++;
        if (retryCount < MAX_RETRIES) {
          timeoutId = setTimeout(() => {
            initChart();
          }, 100);
        }
        return false;
      }

      // Double check chart wasn't created
      if (chartRef.current && seriesRef.current) {
        setChartReady(true);
        return true;
      }

      const containerWidth = chartContainerRef.current.clientWidth || 400;
      if (containerWidth === 0) {
        retryCount++;
        if (retryCount < MAX_RETRIES) {
          timeoutId = setTimeout(() => {
            initChart();
          }, 100);
        }
        return false;
      }

      try {
        // Create chart
        const chart = createChart(chartContainerRef.current, {
          layout: {
            background: { type: ColorType.Solid, color: 'white' },
            textColor: '#333',
          },
          width: containerWidth,
          height: height,
          grid: {
            vertLines: {
              color: '#e0e0e0',
              style: 1,
            },
            horzLines: {
              color: '#e0e0e0',
              style: 1,
            },
          },
          rightPriceScale: {
            borderColor: '#d1d4dc',
            scaleMargins: {
              top: 0.1,
              bottom: 0.1,
            },
            autoScale: true,
          },
          timeScale: {
            borderColor: '#d1d4dc',
            timeVisible: true,
            secondsVisible: false,
          },
        });

        // Add area series
        const areaSeries = chart.addSeries(AreaSeries, {
          lineColor: '#fb923c',
          topColor: 'rgba(251, 146, 60, 0.28)',
          bottomColor: 'rgba(251, 146, 60, 0.05)',
          lineWidth: 2,
          priceFormat: {
            type: 'price',
            precision: 4,
            minMove: 0.0001,
          },
        });

        chartRef.current = chart;
        seriesRef.current = areaSeries;

        // Handle resize
        handleResize = () => {
          if (chartContainerRef.current && chartRef.current) {
            const newWidth = chartContainerRef.current.clientWidth || 400;
            chartRef.current.applyOptions({
              width: newWidth,
            });
          }
        };

        window.addEventListener('resize', handleResize);

        // Mark chart as ready
        setChartReady(true);
        return true;
      } catch (error) {
        return false;
      }
    };

    // Start initialization attempt
    initChart();

    // Cleanup on unmount or when dependencies change
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (handleResize) {
        window.removeEventListener('resize', handleResize);
      }
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        seriesRef.current = null;
      }
      setChartReady(false);
    };
  }, [poolAddress, isLoading, error, height]); // Re-run when container becomes available

  // Update chart height when height prop changes
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({
        height: height,
      });
    }
  }, [height]);

  // Update chart data when priceData changes OR when chart becomes ready
  useEffect(() => {
    // Only proceed if chart is ready AND series exists
    if (!chartReady || !seriesRef.current || !chartRef.current) {
      return;
    }

    // Double-check refs are still valid (race condition protection)
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) {
      return;
    }

    if (priceData.length > 0) {
      // Transform data for TradingView format - ensure correct types
      const chartData = priceData.map((point) => {
        // Ensure time is in correct format (number for timestamps, string for dates)
        let time = point.time;
        if (typeof time === 'string' && time.match(/^\d{4}-\d{2}-\d{2}$/)) {
          // Date string format - TradingView accepts this
          time = time as any;
        } else if (typeof time === 'number') {
          // Unix timestamp - ensure it's a number
          time = time as any;
        }
        
        return {
          time: time,
          value: point.value,
        };
      });

      try {
        series.setData(chartData);
        
        // Fit content to show all data
        chart.timeScale().fitContent();
      } catch (error: any) {
        // Silent fail - chart will retry on next update
      }
    } else if (priceData.length === 0 && chartReady) {
      // Clear data if empty (only if chart is ready to avoid errors)
      try {
        series.setData([]);
      } catch (error) {
        // Silent fail
      }
    }
  }, [priceData, chartReady, timeRange]);

  if (!poolAddress) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 rounded-xl border border-gray-200">
        <p className="text-sm text-gray-500">No pool found</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-white rounded-xl border border-gray-200">
        <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 rounded-xl border border-gray-200">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="w-full relative">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">
          {fromToken} / {toToken}
        </h3>
        <div className="flex gap-1">
          {(['1H', '1D', '1W', '1M'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                timeRange === range
                  ? 'bg-orange-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>
      <div ref={chartContainerRef} className="w-full relative" style={{ height: `${Math.max(height, 350)}px` }} />
      {priceData.length === 0 && !isLoading && !error && (
        <div className="absolute top-12 left-0 right-0 bottom-0 flex items-center justify-center pointer-events-none">
          <p className="text-sm text-gray-500 bg-white/80 px-3 py-1 rounded">No price data available yet</p>
        </div>
      )}
    </div>
  );
}

