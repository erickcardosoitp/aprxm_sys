import asyncio, asyncpg

DSN = "postgresql://neondb_owner:npg_I0UVZq5jmdzM@ep-rough-tooth-an10po6b.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require"

SQL = """
CREATE TABLE IF NOT EXISTS daily_task_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES daily_tasks(id) ON DELETE CASCADE,
    association_id UUID NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    comment TEXT NOT NULL,
    attachment_urls JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_daily_task_comments_task ON daily_task_comments(task_id);
"""

async def main():
    conn = await asyncpg.connect(DSN)
    await conn.execute(SQL)
    print("Tabela daily_task_comments criada.")
    await conn.close()

asyncio.run(main())
