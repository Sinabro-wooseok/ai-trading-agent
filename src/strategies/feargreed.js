// Fear & Greed Index 전략
// 극도의 공포(< 20) → 매수 신호
// 극도의 탐욕(> 80) → 매도 신호
// API: alternative.me/crypto/fear-and-greed-index/

const https = require('https');

let cachedIndex = null;
let lastFetchTime = 0;
const CACHE_TTL = 3600 * 1000; // 1시간 캐시

function fetchFearGreedIndex() {
  return new Promise((resolve) => {
    const now = Date.now();
    if (cachedIndex && now - lastFetchTime < CACHE_TTL) {
      resolve(cachedIndex);
      return;
    }

    const req = https.get('https://api.alternative.me/fng/?limit=1', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const value = parseInt(json.data[0].value);
          const label = json.data[0].value_classification;
          cachedIndex = { value, label };
          lastFetchTime = now;
          resolve(cachedIndex);
        } catch {
          resolve(cachedIndex || { value: 50, label: 'Neutral' });
        }
      });
    });
    req.on('error', () => resolve(cachedIndex || { value: 50, label: 'Neutral' }));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve(cachedIndex || { value: 50, label: 'Neutral' });
    });
  });
}

async function getFearGreedSignal() {
  const { value, label } = await fetchFearGreedIndex();

  if (value <= 20) return { signal: 'BUY', value, label };
  if (value >= 80) return { signal: 'SELL', value, label };
  return { signal: 'HOLD', value, label };
}

module.exports = { getFearGreedSignal, fetchFearGreedIndex };
