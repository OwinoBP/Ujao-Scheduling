const PRODUCTION_API_BASE_URL = ' https://school-bus-ops-api.ujaobusops.workers.dev';

window.APP_CONFIG = {
  API_BASE_URL:
    ['localhost', '127.0.0.1'].includes(window.location.hostname) &&
    window.location.port === '8788'
      ? `http://${window.location.hostname}:8787`
      : PRODUCTION_API_BASE_URL
};
