"""
Stock Price Service using yfinance
Fetches real-time stock prices for Indian market symbols
"""

import yfinance as yf
from typing import Dict, List, Optional
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)


class StockPriceService:
    """Service for fetching Indian stock prices"""
    
    # Common Indian stock symbols (add .NS for NSE, .BO for BSE)
    INDIAN_INDICES = {
        'nifty': '^NSEI',
        'sensex': '^BSESN',
        'banknifty': '^NSEBANK',
    }
    
    def __init__(self):
        """Initialize the stock price service"""
        self.cache = {}
        self.cache_duration = timedelta(minutes=5)  # Cache for 5 minutes
    
    def normalize_symbol(self, symbol: str) -> str:
        """
        Normalize symbol to yfinance format
        
        Args:
            symbol: Stock symbol (e.g., 'RELIANCE', 'TCS', 'INFY')
            
        Returns:
            Normalized symbol with exchange suffix
        """
        symbol = symbol.upper().strip()
        
        # Check if it's an index
        if symbol.lower() in self.INDIAN_INDICES:
            return self.INDIAN_INDICES[symbol.lower()]
        
        # If already has suffix, return as is
        if symbol.endswith('.NS') or symbol.endswith('.BO'):
            return symbol
        
        # Default to NSE (.NS)
        return f"{symbol}.NS"
    
    def get_stock_price(self, symbol: str) -> Optional[Dict]:
        """
        Get current stock price and basic info
        
        Args:
            symbol: Stock symbol (e.g., 'RELIANCE', 'TCS')
            
        Returns:
            Dict with price info or None if failed
        """
        try:
            normalized_symbol = self.normalize_symbol(symbol)
            
            # Check cache
            cache_key = normalized_symbol
            if cache_key in self.cache:
                cached_data, cached_time = self.cache[cache_key]
                if datetime.now() - cached_time < self.cache_duration:
                    logger.info(f"Returning cached data for {symbol}")
                    return cached_data
            
            # Fetch from yfinance
            ticker = yf.Ticker(normalized_symbol)
            info = ticker.info
            
            # Get current price (try multiple fields)
            current_price = (
                info.get('currentPrice') or 
                info.get('regularMarketPrice') or 
                info.get('previousClose')
            )
            
            if not current_price:
                logger.error(f"Could not find price for {symbol}")
                return None
            
            # Prepare response
            data = {
                'symbol': symbol,
                'normalized_symbol': normalized_symbol,
                'current_price': round(current_price, 2),
                'currency': info.get('currency', 'INR'),
                'company_name': info.get('longName', info.get('shortName', symbol)),
                'previous_close': info.get('previousClose'),
                'open': info.get('open'),
                'day_high': info.get('dayHigh'),
                'day_low': info.get('dayLow'),
                'volume': info.get('volume'),
                'market_cap': info.get('marketCap'),
                'pe_ratio': info.get('trailingPE'),
                'change': None,
                'change_percent': None,
                'timestamp': datetime.now().isoformat(),
            }
            
            # Calculate change
            if data['previous_close'] and data['current_price']:
                change = data['current_price'] - data['previous_close']
                change_percent = (change / data['previous_close']) * 100
                data['change'] = round(change, 2)
                data['change_percent'] = round(change_percent, 2)
            
            # Cache the result
            self.cache[cache_key] = (data, datetime.now())
            
            logger.info(f"Fetched {symbol}: ₹{current_price}")
            return data
            
        except Exception as e:
            logger.error(f"Error fetching {symbol}: {e}")
            return None
    
    def get_multiple_stocks(self, symbols: List[str]) -> Dict[str, Optional[Dict]]:
        """
        Get prices for multiple stocks
        
        Args:
            symbols: List of stock symbols
            
        Returns:
            Dict mapping symbols to their data
        """
        results = {}
        for symbol in symbols:
            results[symbol] = self.get_stock_price(symbol)
        return results
    
    def get_historical_data(
        self, 
        symbol: str, 
        period: str = "1mo",
        interval: str = "1d"
    ) -> Optional[Dict]:
        """
        Get historical price data
        
        Args:
            symbol: Stock symbol
            period: Period to fetch (1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, max)
            interval: Data interval (1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo, 3mo)
            
        Returns:
            Dict with historical data
        """
        try:
            normalized_symbol = self.normalize_symbol(symbol)
            ticker = yf.Ticker(normalized_symbol)
            
            # Fetch historical data
            hist = ticker.history(period=period, interval=interval)
            
            if hist.empty:
                return None
            
            # Convert to dict format
            data = {
                'symbol': symbol,
                'period': period,
                'interval': interval,
                'data': []
            }
            
            for index, row in hist.iterrows():
                data['data'].append({
                    'date': index.isoformat(),
                    'open': round(row['Open'], 2),
                    'high': round(row['High'], 2),
                    'low': round(row['Low'], 2),
                    'close': round(row['Close'], 2),
                    'volume': int(row['Volume']),
                })
            
            return data
            
        except Exception as e:
            logger.error(f"Error fetching historical data for {symbol}: {e}")
            return None
    
    def search_stock(self, query: str) -> List[Dict]:
        """
        Search for stocks by name or symbol
        
        Args:
            query: Search query
            
        Returns:
            List of matching stocks
        """
        # Common Indian stocks (expand this list)
        common_stocks = {
            'RELIANCE': 'Reliance Industries',
            'TCS': 'Tata Consultancy Services',
            'HDFCBANK': 'HDFC Bank',
            'INFY': 'Infosys',
            'ICICIBANK': 'ICICI Bank',
            'HINDUNILVR': 'Hindustan Unilever',
            'ITC': 'ITC Limited',
            'SBIN': 'State Bank of India',
            'BHARTIARTL': 'Bharti Airtel',
            'KOTAKBANK': 'Kotak Mahindra Bank',
            'WIPRO': 'Wipro',
            'BAJFINANCE': 'Bajaj Finance',
            'ASIANPAINT': 'Asian Paints',
            'MARUTI': 'Maruti Suzuki',
            'AXISBANK': 'Axis Bank',
            'LT': 'Larsen & Toubro',
            'TITAN': 'Titan Company',
            'SUNPHARMA': 'Sun Pharmaceutical',
            'ULTRACEMCO': 'UltraTech Cement',
            'NESTLEIND': 'Nestle India',
        }
        
        query_lower = query.lower()
        results = []
        
        for symbol, name in common_stocks.items():
            if query_lower in symbol.lower() or query_lower in name.lower():
                results.append({
                    'symbol': symbol,
                    'name': name,
                    'exchange': 'NSE',
                })
        
        return results[:10]  # Limit to 10 results


# Example usage
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    
    service = StockPriceService()
    
    # Test single stock
    print("\n=== Single Stock ===")
    reliance = service.get_stock_price('RELIANCE')
    if reliance:
        print(f"{reliance['company_name']}: ₹{reliance['current_price']}")
        print(f"Change: ₹{reliance['change']} ({reliance['change_percent']}%)")
    
    # Test multiple stocks
    print("\n=== Multiple Stocks ===")
    stocks = service.get_multiple_stocks(['TCS', 'INFY', 'WIPRO'])
    for symbol, data in stocks.items():
        if data:
            print(f"{symbol}: ₹{data['current_price']}")
    
    # Test index
    print("\n=== Index ===")
    nifty = service.get_stock_price('NIFTY')
    if nifty:
        print(f"Nifty 50: {nifty['current_price']}")
    
    # Test search
    print("\n=== Search ===")
    results = service.search_stock('bank')
    for r in results:
        print(f"{r['symbol']}: {r['name']}")
