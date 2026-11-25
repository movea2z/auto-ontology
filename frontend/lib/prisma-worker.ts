// SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { env } from 'cloudflare:workers';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma-worker/client';

/** Create a client in the current Worker invocation; Hyperdrive owns the origin pool. */
export function getPrisma(): PrismaClient {
	const { HYPERDRIVE } = env as { HYPERDRIVE?: { connectionString: string } };
	if (!HYPERDRIVE?.connectionString) {
		throw new Error('The HYPERDRIVE binding is required');
	}
	const adapter = new PrismaPg(
		{ connectionString: HYPERDRIVE.connectionString },
		{ schema: 'frontend' },
	);
	return new PrismaClient({ adapter });
}
