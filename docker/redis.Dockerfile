FROM redis:7.4-bookworm

# Append-only persistence, matching the compose stack.
CMD ["redis-server", "--appendonly", "yes"]
