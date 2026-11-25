// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// The frontend authenticates requests in-process. In the Workers build this
// uses the same Prisma-backed frontend schema as the existing Python services.

import { getPrisma } from '@/lib/prisma';
import { createAuth } from '@/auth/better-auth-core';

export function getAuth() {
	return createAuth(getPrisma());
}

/** True once at least one SSO provider has been registered. */
export const isSsoConfigured = async (): Promise<boolean> =>
	(await getPrisma().ssoProvider.count()) > 0;
