// SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { withPermission } from '@/auth/with-auth';
import { proxyToBackend } from '@/auth/proxy-backend';

// Key/value stored in the `configurations` table. The Python ingestion service
// reads this same key (see auto_ontology/infra/feature_flags.py) once per compilation run
// to decide whether to run the per-column SELECT DISTINCT probes. It does NOT
// gate the bounded row sample, which always runs.
//
// Unlike semantic compilation, this flag is opt-OUT: an instance that has never
// touched the toggle still probes, which is what every deployment predating the
// toggle did.
const CONFIG_KEY = 'distinct_value_probing_enabled';

// Report whether compilation scans low-cardinality columns for distinct values.
//
// The container reads the flag the way this route used to (see
// auto_ontology/infra/feature_flags.py), so the answer is unchanged.
export const GET = withPermission({ semanticCompilation: ['read'] })(async (req) =>
	proxyToBackend(req),
);

// Turn distinct value scanning on or off instance-wide (admin-only).
//
// Deliberately does NOT trigger a compilation run. The flag is read at the top
// of each run, so it applies from the next one onward — flipping it is a change
// of policy, not a request to recompile. Operators who want it applied now can
// use Reset, which is on the same page.
//
// The boolean validation and the upsert now happen in the container, which owns
// the flag, so the request forwards verbatim.
export const PUT = withPermission({ semanticCompilation: ['manage'] })(async (req) =>
	proxyToBackend(req),
);
