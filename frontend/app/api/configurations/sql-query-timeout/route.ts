// SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { withPermission } from '@/auth/with-auth';
import { proxyToBackend } from '@/auth/proxy-backend';

// Key/value stored in the `configurations` table. The text-to-SQL pipeline
// reads this same key (see auto_ontology/infra/feature_flags.py) before each
// statement it issues, and cancels the statement once it runs this long. An
// absent row means 30 seconds, which is also what a backend running without
// this frontend uses.

// Report the instance-wide SQL query timeout, in seconds.
//
// The container reads the flag the way this route used to (see
// auto_ontology/infra/feature_flags.py), so the answer is unchanged.
export const GET = withPermission({ visualization: ['read'] })(async (req) =>
	proxyToBackend(req),
);

// Set the instance-wide SQL query timeout (admin-only).
//
// Rejects anything but an in-range integer rather than coercing it: the backend
// treats an unusable stored value as the default, so a coerced value would be
// silently ignored while the page showed it as saved.
//
// The validation and the upsert now happen in the container, which owns the
// flag, so the request forwards verbatim.
export const PUT = withPermission({ visualization: ['manage'] })(async (req) =>
	proxyToBackend(req),
);
