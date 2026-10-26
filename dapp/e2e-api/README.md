# API tests (throwaway Redis)

These hit a running dev server whose Redis is a local, disposable instance —
never production.

```sh
# 1. a local Upstash-compatible Redis
docker network create gd-test
docker run -d --rm --name gd-redis --network gd-test redis:7-alpine
docker run -d --rm --name gd-srh --network gd-test -p 8079:80 \
  -e SRH_MODE=env -e SRH_TOKEN=local_test_token -e SRH_CONNECTION_STRING=redis://gd-redis:6379 \
  hiett/serverless-redis-http:latest

# 2. a dev server pointed at it
UPSTASH_REDIS_REST_URL=http://localhost:8079 UPSTASH_REDIS_REST_TOKEN=local_test_token \
  NEXT_DIST_DIR=.next-events npx next dev -p 3105

# 3. the tests
npm run e2e:api
```
