// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { withPermission } from '@/auth/with-auth';
import { proxyToBackend } from '@/auth/proxy-backend';

type Ctx = { params: Promise<{ id: string }> };

// Append a message to a conversation the caller owns.
//
// The manual path, for clients that record their own turns; the chat routes
// persist their messages themselves via FastAPI, so a normal chat flow never
// calls this. Also bumps the conversation's `updated_at`. 404 when the
// conversation does not exist or belongs to someone else.
//
// The id comes from the path; the userId scopes the write so a caller can only
// add to a conversation they own.
export const POST = withPermission<Ctx>({ conversation: ['write'] })(async (
	req,
	{ user },
) => proxyToBackend(req, { userId: user.id }),
);
