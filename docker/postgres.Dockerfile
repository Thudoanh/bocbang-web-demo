FROM postgres:16-bookworm

# Password stays out of the image; pass POSTGRES_PASSWORD at run time.
ENV POSTGRES_USER=bocbang \
    POSTGRES_DB=bocbang
