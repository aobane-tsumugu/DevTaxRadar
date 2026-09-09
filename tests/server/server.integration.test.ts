import type { DashboardData, LocalConfiguration } from '../../src/client/types.js'
import { saveConfigurationFixture, savePlanningFixture } from './helpers/workspace-fixture.js'

const children: ChildProcess[] = []

// __UNTOUCHED_FILE_CONTENT__
    }
    const saveResponse = await saveConfigurationFixture(configuration, {
      port,
      csrfToken: runtime.csrfToken,
    })
    expect(saveResponse.status).toBe(200)
    expect(await saveResponse.json()).toMatchObject({ configuration })

// __UNTOUCHED_FILE_CONTENT__
    })

    const unknownSaveResponse = await saveConfigurationFixture({ ...configuration, unobservedRatio: null }, {
      port,
      csrfToken: runtime.csrfToken,
    })
    expect(unknownSaveResponse.status).toBe(200)

// __UNTOUCHED_FILE_CONTENT__
    }
    const postMonthly = (body: unknown) =>
      saveConfigurationFixture(body, { port, csrfToken: runtime.csrfToken })
    expect((await postMonthly(unknownMonthConfiguration)).status).toBe(200)

// __UNTOUCHED_FILE_CONTENT__
    }
    const datedSaveResponse = await saveConfigurationFixture(datedConfiguration, {
      port,
      csrfToken: runtime.csrfToken,
    })
    expect(datedSaveResponse.status).toBe(200)

// __UNTOUCHED_FILE_CONTENT__
      body: JSON.stringify(legacyConfiguration),
    })
    // An unversioned legacy client cannot overwrite the current workspace.
    expect(legacySaveResponse.status).toBe(404)
    const afterLegacySave = (await fetch(`http://127.0.0.1:${port}/api/config`).then(

// __UNTOUCHED_FILE_CONTENT__
    ).toContain('請求の証拠参照が現在の記録にありません：receipt-ai')

    const restoreEmptyPeriodsResponse = await saveConfigurationFixture(configuration, {
      port,
      csrfToken: runtime.csrfToken,
    })
    expect(restoreEmptyPeriodsResponse.status).toBe(200)

// __UNTOUCHED_FILE_CONTENT__
    }
    const planningResponse = await savePlanningFixture(planningSnapshot, {
      port,
      csrfToken: runtime.csrfToken,
    })
    expect(planningResponse.status).toBe(200)

// __UNTOUCHED_FILE_CONTENT__
    expect(serializedDashboard).not.toContain('synthetic-claude-session-1')

    const laterContractResponse = await saveConfigurationFixture({
        ...configuration,
        contracts: { claude: { startedOn: '2030-01-01' }, codex: { startedOn: '2030-01-01' } },
      }, {
      port,
      csrfToken: runtime.csrfToken,
    })
    expect(laterContractResponse.status).toBe(200)

// __UNTOUCHED_FILE_CONTENT__
    )

    const restoreConfigurationResponse = await saveConfigurationFixture(configuration, {
      port,
      csrfToken: runtime.csrfToken,
    })
    expect(restoreConfigurationResponse.status).toBe(200)

// __UNTOUCHED_FILE_CONTENT__
    expect(restoreConfigurationResponse.status).toBe(200)

    const duplicateChargeResponse = await saveConfigurationFixture({
        ...configuration,
        monthlyCharges: [configuration.monthlyCharges[0], configuration.monthlyCharges[0]],
      }, {
      port,
      csrfToken: runtime.csrfToken,
    })
    expect(duplicateChargeResponse.status).toBe(400)

// __UNTOUCHED_FILE_CONTENT__
    expect(duplicateChargeResponse.status).toBe(400)

    const invalidContractResponse = await saveConfigurationFixture({
        ...configuration,
        contracts: { claude: { startedOn: '2026-07-01', endedOn: '2026-06-30' }, codex: {} },
      }, {
      port,
      csrfToken: runtime.csrfToken,
    })
    expect(invalidContractResponse.status).toBe(400)

// __UNTOUCHED_FILE_CONTENT__
    }
    const clearResponse = await saveConfigurationFixture(clearedConfiguration, {
      port,
      csrfToken: runtime.csrfToken,
    })
    expect(clearResponse.status).toBe(200)
