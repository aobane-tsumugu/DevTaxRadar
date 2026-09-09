import type { DashboardData, LocalConfiguration } from '../../src/client/types.js'

const children: ChildProcess[] = []

// __UNTOUCHED_FILE_CONTENT__
    }
    const saveResponse = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
      body: JSON.stringify(configuration),
    })
    expect(saveResponse.status).toBe(200)
    expect(await saveResponse.json()).toEqual({ saved: true })

// __UNTOUCHED_FILE_CONTENT__
    })
    const unknownSaveResponse = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
      body: JSON.stringify({ ...configuration, unobservedRatio: null }),
    })
    expect(unknownSaveResponse.status).toBe(200)

// __UNTOUCHED_FILE_CONTENT__
    }
    const postMonthly = (body: unknown) =>
      fetch(`http://127.0.0.1:${port}/api/config`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: `http://127.0.0.1:${port}`,
          'x-devtax-csrf': runtime.csrfToken,
        },
        body: JSON.stringify(body),
      })
    expect((await postMonthly(unknownMonthConfiguration)).status).toBe(200)

// __UNTOUCHED_FILE_CONTENT__
    }
    const datedSaveResponse = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
      body: JSON.stringify(datedConfiguration),
    })
    expect(datedSaveResponse.status).toBe(200)

// __UNTOUCHED_FILE_CONTENT__
      body: JSON.stringify(legacyConfiguration),
    })
    expect(legacySaveResponse.status).toBe(200)
    const afterLegacySave = (await fetch(`http://127.0.0.1:${port}/api/config`).then(

// __UNTOUCHED_FILE_CONTENT__
    ).toContain('請求の証拠参照が現在の記録にありません：receipt-ai')

    const restoreEmptyPeriodsResponse = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
      body: JSON.stringify(configuration),
    })
    expect(restoreEmptyPeriodsResponse.status).toBe(200)

// __UNTOUCHED_FILE_CONTENT__
    }
    const planningResponse = await fetch(`http://127.0.0.1:${port}/api/planning`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
      body: JSON.stringify(planningSnapshot),
    })
    expect(planningResponse.status).toBe(200)

// __UNTOUCHED_FILE_CONTENT__
    expect(serializedDashboard).not.toContain('synthetic-claude-session-1')

    const laterContractResponse = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
      body: JSON.stringify({
        ...configuration,
        contracts: { claude: { startedOn: '2030-01-01' }, codex: { startedOn: '2030-01-01' } },
      }),
    })
    expect(laterContractResponse.status).toBe(200)

// __UNTOUCHED_FILE_CONTENT__
    )

    const restoreConfigurationResponse = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
      body: JSON.stringify(configuration),
    })
    expect(restoreConfigurationResponse.status).toBe(200)

// __UNTOUCHED_FILE_CONTENT__
    expect(restoreConfigurationResponse.status).toBe(200)

    const duplicateChargeResponse = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
      body: JSON.stringify({
        ...configuration,
        monthlyCharges: [configuration.monthlyCharges[0], configuration.monthlyCharges[0]],
      }),
    })
    expect(duplicateChargeResponse.status).toBe(400)

// __UNTOUCHED_FILE_CONTENT__
    expect(duplicateChargeResponse.status).toBe(400)

    const invalidContractResponse = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
      body: JSON.stringify({
        ...configuration,
        contracts: { claude: { startedOn: '2026-07-01', endedOn: '2026-06-30' }, codex: {} },
      }),
    })
    expect(invalidContractResponse.status).toBe(400)

// __UNTOUCHED_FILE_CONTENT__
    }
    const clearResponse = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
      body: JSON.stringify(clearedConfiguration),
    })
    expect(clearResponse.status).toBe(200)
