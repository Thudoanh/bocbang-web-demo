"""Migrate all domain data from Supabase PostgreSQL to MySQL."""

import asyncio
import json
import uuid
from datetime import datetime
import asyncpg
import pymysql

PG_URL = "postgresql://postgres.mcochkzarlxpqyrxddve:bocbang%40123@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres"

MYSQL_CONFIG = {
    "host": "103.163.215.105",
    "port": 3366,
    "user": "dev",
    "password": "123abc@A",
    "database": "bocbang_v2",
    "charset": "utf8mb4",
    "autocommit": False,
}

TABLES = [
    "users",
    "meetings",
    "meeting_members",
    "transcripts",
    "speakers",
    "transcript_versions",
    "current_segments",
    "segment_versions",
    "transcript_edit_events",
    "summaries",
    "summary_versions",
    "translations",
    "translation_segments",
    "media_files",
    "jobs",
    "meeting_audio_chunks",
    "comments",
    "share_links",
    "exports",
    "meeting_sections",
    "voice_profiles",
    "email_otps",
]

def serialize_value(val):
    if val is None:
        return None
    if isinstance(val, uuid.UUID):
        return val.hex
    if isinstance(val, (dict, list)):
        return json.dumps(val)
    if isinstance(val, datetime):
        return val.strftime("%Y-%m-%d %H:%M:%S.%f")
    return val

async def run_migration():
    print("Connecting to Supabase PostgreSQL...")
    pg_conn = await asyncpg.connect(PG_URL, statement_cache_size=0)
    print("Connecting to MySQL bocbang_v2...")
    my_conn = pymysql.connect(**MYSQL_CONFIG)

    try:
        with my_conn.cursor() as cur:
            cur.execute("SET FOREIGN_KEY_CHECKS = 0;")
            
            for table in TABLES:
                print(f"Fetching from {table}...")
                rows = await pg_conn.fetch(f"SELECT * FROM {table}")
                if not rows:
                    print(f"  {table}: 0 rows (skipped)")
                    continue
                
                columns = list(rows[0].keys())
                col_names = ", ".join([f"`{c}`" for c in columns])
                placeholders = ", ".join(["%s"] * len(columns))
                insert_sql = f"REPLACE INTO `{table}` ({col_names}) VALUES ({placeholders})"
                
                batch_data = []
                for row in rows:
                    row_vals = [serialize_value(row[c]) for c in columns]
                    batch_data.append(row_vals)
                
                chunk_size = 500
                for i in range(0, len(batch_data), chunk_size):
                    chunk = batch_data[i:i + chunk_size]
                    cur.executemany(insert_sql, chunk)
                
                my_conn.commit()
                print(f"  {table}: successfully migrated {len(rows)} rows!")
            
            cur.execute("SET FOREIGN_KEY_CHECKS = 1;")
            my_conn.commit()
        print("MIGRATION COMPLETED SUCCESSFULLY!")
    finally:
        my_conn.close()
        await pg_conn.close()

if __name__ == "__main__":
    asyncio.run(run_migration())
