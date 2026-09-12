# Voltbets settlement worker — a one-shot cron JOB, not a web service.
#
# The worker is stdlib-only on purpose (it started life on shared cPanel hosting
# with no pip and no compiler), so this image needs no dependencies and builds
# in seconds. It makes OUTBOUND HTTPS calls only:
#   * no listening port
#   * no public domain
#   * no healthcheck  (which is why worker/railway.json deliberately omits one —
#     a job that exits is not a service that can answer /api/health)
#
# Railway builds this with the service's Root Directory set to `worker`.
FROM python:3.12-slim

# Unbuffered stdout: a cron run whose logs only appear when it exits is useless
# to debug — failures need to be visible while the run is happening.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app
COPY settle_worker.py run.sh /app/
RUN chmod +x /app/run.sh

CMD ["/app/run.sh"]
