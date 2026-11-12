// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { withPermission } from '@/auth/with-auth';
import { proxyToBackend } from '@/auth/proxy-backend';

// List the caller's own conversations, newest first, without their messages.
//
// Scoped to the authenticated user: a conversation is only ever visible to its
// owner, so there is no way to list someone else's. The id is forwarded as the
// caller's identity so the container can scope by it.
export const GET = withPermission({ conversation: ['read'] })(async (_req, { user }) =>
	proxyToBackend(_req, { userId: user.id }),
);

// Start a new, empty conversation owned by the caller.
//
// `title` is optional and defaults to empty. Chat clients usually create the
// conversation here first, then pass its id to `POST /api/chat/completions`.
export const POST = withPermission({ conversation: ['write'] })(async (req, { user }) =>
	proxyToBackend(req, { userId: user.id }),
);
