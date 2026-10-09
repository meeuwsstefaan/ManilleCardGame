import {getStore} from '@netlify/blobs';
import {createHandler} from '../analytics-service.mjs';

export default request => {
  // Netlify draft URLs contain "--"; never mix their tests with production.
  const preview = new URL(request.url).hostname.includes('--');
  return createHandler(() => getStore({name: preview ? 'manille-analytics-preview-v1' : 'manille-analytics-v1', consistency: 'strong'}))(request);
};
export const config = {
  rateLimit: {windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'], action: 'rate_limit'},
};
