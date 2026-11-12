// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { withPermission } from '@/auth/with-auth';
import { proxyToBackend } from '@/auth/proxy-backend';

type Ctx = { params: Promise<{ id: string }> };

// Update an acronym's name or description.
//
// Both fields are optional and only the ones present in the body are written,
// so a partial body leaves the rest of the record untouched. The id is read
// from the path by the container, which owns the record.
export const PATCH = withPermission<Ctx>({ acronym: ['update'] })(async (req) =>
	proxyToBackend(req),
);

// Delete an acronym permanently. Answers 204 with no body.
export const DELETE = withPermission<Ctx>({ acronym: ['delete'] })(async (req) =>
	proxyToBackend(req),
);
