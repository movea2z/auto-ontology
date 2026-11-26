// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

config({ path: '../.env' });

const user = process.env.POSTGRES_USER ?? 'postgres';
const password = process.env.POSTGRES_PASSWORD ?? '';
const host = process.env.POSTGRES_HOST ?? 'localhost';
const port = process.env.POSTGRES_PORT ?? '5432';
const database = process.env.POSTGRES_DATABASE ?? 'auto_ontology';

// Prefer Neon's pooled DATABASE_URL when set (already carries sslmode=require +
// host/port/creds); fall back to the per-field POSTGRES_* vars for local dev.
const base = process.env.DATABASE_URL
	? process.env.DATABASE_URL
	: `postgresql://${user}:${password}@${host}:${port}/${database}`;
// `?schema=frontend` is load-bearing. Prisma issues unqualified DDL and lets the
// connection's search_path decide where it lands; without it tables follow the
// server default (resolving "$user" to the role's own schema) instead of `frontend`.
const sep = base.includes('?') ? '&' : '?';

export default defineConfig({
	schema: 'prisma/schema.prisma',
	migrations: {
		path: 'prisma/migrations',
	},
	datasource: {
		url: `${base}${sep}schema=frontend`,
	},
});
