# Database (Amazon RDS for PostgreSQL)

`schema.sql` creates the `items` table and three sample rows. It is safe to run more than once, and it adds the `image_key` column to databases created before photo uploads existed.

Apply it from the backend EC2 (the only machine allowed to reach RDS), connecting over TLS as the app user:

```bash
psql "host=RDS_ENDPOINT port=5432 dbname=crud_demo user=crud_app sslmode=verify-full sslrootcert=/etc/ssl/certs/rds-global-bundle.pem" -f schema.sql
```

Photos are not stored in the database. `image_key` holds the S3 object key (for example `items/<product id>/<random id>.jpg`); the file itself lives in the private S3 bucket.
