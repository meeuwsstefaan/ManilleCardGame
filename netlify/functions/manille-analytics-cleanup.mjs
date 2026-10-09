import {getStore} from '@netlify/blobs';
import {removeExpired} from '../analytics-service.mjs';

export default async () => {
  await removeExpired(getStore({name: 'manille-analytics-v1', consistency: 'strong'}));
  return new Response(null, {status: 204});
};
export const config = {schedule: '17 3 * * *'};
