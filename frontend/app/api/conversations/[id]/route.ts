// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { withPermission } from '@/auth/with-auth';
import { proxyToBackend } from '@/auth/proxy-backend';

type Ctx = { params: Promise<{ id: string }> };

// Fetch one conversation with its full message history, oldest message first.
//
// Scoped to the caller, so another user's conversation reads as 404 rather than
// 403 — ownership is not disclosed. The id comes from the path; the userId
// scopes the read so one user cannot read another's conversation.
export const GET = withPermission<Ctx>({ conversation: ['read'] })(async (
	_req,
	{ user },
) => proxyToBackend(_req, { userId: user.id }),
);

// Rename a conversation the caller owns; 404 when it is not theirs.
export const PATCH = withPermission<Ctx>({ conversation: ['write'] })(async (
	req,
	{ user },
) => proxyToBackend(req, { userId: user.id }),
);

// Delete a conversation and its messages; 404 when it is not the caller's.
//
// Answers 204 with no body. The delete cascades to the conversation's messages.
export const DELETE = withPermission<Ctx>({ conversation: ['delete'] })(async (
	_req,
	{ user },
) => proxyToBackend(_req, { userId: user.id }),
);
