// Unit tests for N2kDevice address claim option mapping.

jest.mock('./persist', () => ({
  getPersistedData: jest.fn(() => undefined),
  savePersistedData: jest.fn()
}))

import { CanDevice } from './candevice'

function makeOptions(overrides: Record<string, unknown> = {}) {
  return {
    // app is required for CanDevice to register its analyzer listener.
    // Use a minimal stub so the constructor doesn't blow up.
    app: { on: () => undefined, removeListener: () => undefined },
    providerId: 'test',
    uniqueNumber: 12345,
    ...overrides
  }
}

describe('N2kDevice address claim options', () => {
  // Hoisted so afterEach can stop the device created in each test even
  // if the test body throws — otherwise a failing assertion leaks the
  // addressClaimChecker / heartbeatInterval into the next test run.
  let dev: CanDevice | undefined

  afterEach(() => {
    if (dev) {
      dev.stop()
      dev = undefined
    }
  })

  test('caller-supplied addressClaim with legacy top-level uniqueNumber is honored', () => {
    // Older callers passed an addressClaim object with `uniqueNumber`
    // (or the human-readable `'Unique Number'`) at the top level.
    // The encoder ignores both and reads `.fields.uniqueNumber` only,
    // so we promote the legacy value into `.fields` rather than letting
    // options.uniqueNumber / persistence silently overwrite it.
    const legacyClaim: any = { uniqueNumber: 7777777 }
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({
        addressClaim: legacyClaim,
        uniqueNumber: 1111111 // would otherwise win
      })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.uniqueNumber).toBe(7777777)
  })

  test("caller-supplied addressClaim with legacy 'Unique Number' key is honored", () => {
    // Same fallback as the previous test, but supplied via the
    // human-readable key the canboat JSON uses. Exercises the
    // `ac['Unique Number']` arm of the `??` chain.
    const legacyClaim: any = { 'Unique Number': 9999999 }
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({
        addressClaim: legacyClaim,
        uniqueNumber: 1111111 // would otherwise win
      })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.uniqueNumber).toBe(9999999)
  })

  test('caller-supplied addressClaim with .fields.uniqueNumber is honored', () => {
    const claim: any = { fields: { uniqueNumber: 8888888 } }
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({
        addressClaim: claim,
        uniqueNumber: 2222222 // would otherwise win
      })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.uniqueNumber).toBe(8888888)
  })

  test('uniqueNumber from options lands on addressClaim.fields (not top-level)', () => {
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({ uniqueNumber: 1150522 })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.uniqueNumber).toBe(1150522)
  })

  test('defaults: deviceInstanceLower=0, deviceInstanceUpper=0, systemInstance=0', () => {
    dev = new CanDevice({ sendPGN: () => undefined }, makeOptions())
    const ac: any = dev.addressClaim
    expect(ac.fields.deviceInstanceLower).toBe(0)
    expect(ac.fields.deviceInstanceUpper).toBe(0)
    expect(ac.fields.systemInstance).toBe(0)
  })

  test('combined deviceInstance = 5 → lower=5, upper=0', () => {
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({ deviceInstance: 5 })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.deviceInstanceLower).toBe(5)
    expect(ac.fields.deviceInstanceUpper).toBe(0)
  })

  test('combined deviceInstance = 12 → lower=4, upper=1', () => {
    // 12 = (1<<3) | 4
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({ deviceInstance: 12 })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.deviceInstanceLower).toBe(4)
    expect(ac.fields.deviceInstanceUpper).toBe(1)
  })

  test('combined deviceInstance = 255 → lower=7, upper=31', () => {
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({ deviceInstance: 255 })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.deviceInstanceLower).toBe(7)
    expect(ac.fields.deviceInstanceUpper).toBe(31)
  })

  test('explicit deviceInstanceLower / deviceInstanceUpper override combined', () => {
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({
        deviceInstance: 0, // would split to (0,0)
        deviceInstanceLower: 3,
        deviceInstanceUpper: 9
      })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.deviceInstanceLower).toBe(3)
    expect(ac.fields.deviceInstanceUpper).toBe(9)
  })

  test('systemInstance = 7 is applied', () => {
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({ systemInstance: 7 })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.systemInstance).toBe(7)
  })

  test('numeric strings ("3") are coerced — admin UI form inputs deliver strings', () => {
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({ deviceInstance: '3', systemInstance: '5' })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.deviceInstanceLower).toBe(3)
    expect(ac.fields.deviceInstanceUpper).toBe(0)
    expect(ac.fields.systemInstance).toBe(5)
  })

  test('non-numeric instance values fall back to 0', () => {
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({
        deviceInstance: 'huh',
        systemInstance: null
      })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.deviceInstanceLower).toBe(0)
    expect(ac.fields.deviceInstanceUpper).toBe(0)
    expect(ac.fields.systemInstance).toBe(0)
  })

  test('out-of-range values fall back to 0 (no silent bit-mask wrap)', () => {
    // Bit-masking a 257 produces deviceInstance=1, which surprises the
    // user who set it to 257 thinking the bus would carry that exact
    // value. Drop the input on the floor instead.
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({
        deviceInstance: 257,
        deviceInstanceLower: 8, // > 0x07
        deviceInstanceUpper: 32, // > 0x1f
        systemInstance: 16 // > 0x0f
      })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.deviceInstanceLower).toBe(0)
    expect(ac.fields.deviceInstanceUpper).toBe(0)
    expect(ac.fields.systemInstance).toBe(0)
  })

  test('negative values fall back to 0', () => {
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({
        deviceInstance: -1,
        systemInstance: -5
      })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.deviceInstanceLower).toBe(0)
    expect(ac.fields.deviceInstanceUpper).toBe(0)
    expect(ac.fields.systemInstance).toBe(0)
  })
})

describe('identical NAME address claims', () => {
  // Two devices presenting byte-identical 64-bit NAMEs (e.g. a cloned
  // SignalK config dir on a second machine) can't be separated by ISO
  // arbitration — the < / > comparison never fires. The device must
  // yield its address instead of standing off forever.
  let dev: CanDevice | undefined
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    jest.useFakeTimers()
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    if (dev) {
      dev.stop()
      dev = undefined
    }
    jest.useRealTimers()
    errorSpy.mockRestore()
  })

  // An incoming 60928 whose data bytes encode exactly our own NAME,
  // claiming whatever address the device currently holds. The claim
  // comparison encodes only the 8 data bytes, so header differences
  // (src/dst/prio) don't matter — but src must match our address for
  // the conflict path to run at all.
  function claimForOwnAddress(
    device: CanDevice,
    fieldOverrides: Record<string, unknown> = {}
  ) {
    return {
      pgn: 60928,
      dst: 255,
      src: device.address,
      prio: 6,
      fields: { ...(device.addressClaim as any).fields, ...fieldOverrides }
    } as any
  }

  test('configured uniqueNumber: yields address, keeps identity, raises error', () => {
    const canbus = { sendPGN: jest.fn() }
    const app = {
      on: () => undefined,
      removeListener: () => undefined,
      setProviderError: jest.fn(),
      setProviderStatus: jest.fn()
    }
    dev = new CanDevice(canbus, makeOptions({ app, uniqueNumber: 613748 }))
    dev.cansend = true
    const before = dev.address

    dev.n2kMessage(claimForOwnAddress(dev))

    expect(dev.address).not.toBe(before)
    expect((dev.addressClaim as any).fields.uniqueNumber).toBe(613748)
    expect(dev.foundConflict).toBe(true)
    expect(app.setProviderError).toHaveBeenCalledWith(
      'test',
      expect.stringContaining('identical NAME')
    )
    // the re-claim goes out after the randomized decorrelation delay
    expect(canbus.sendPGN).not.toHaveBeenCalled()
    jest.advanceTimersByTime(160)
    expect(canbus.sendPGN).toHaveBeenCalled()
  })

  test('unconfigured uniqueNumber: re-randomizes and persists a new one', () => {
    const { savePersistedData } = jest.requireMock('./persist')
    savePersistedData.mockClear()
    const canbus = { sendPGN: jest.fn() }
    dev = new CanDevice(canbus, makeOptions({ uniqueNumber: undefined }))
    dev.cansend = true
    const before = dev.address

    dev.n2kMessage(claimForOwnAddress(dev))

    expect(dev.address).not.toBe(before)
    // constructor persisted the initial random number, the conflict
    // reaction persisted the replacement — and the claim now carries it
    const calls = savePersistedData.mock.calls.filter(
      (c: unknown[]) => c[2] === 'uniqueNumber'
    )
    expect(calls.length).toBe(2)
    expect((dev.addressClaim as any).fields.uniqueNumber).toBe(calls[1][3])
  })

  test('reactions are capped so transmit-echo cannot cause endless hopping', () => {
    const canbus = { sendPGN: jest.fn() }
    dev = new CanDevice(canbus, makeOptions({ uniqueNumber: 613748 }))
    dev.cansend = true

    const seen: number[] = []
    for (let i = 0; i < 6; i++) {
      seen.push(dev.address)
      dev.n2kMessage(claimForOwnAddress(dev))
    }

    // four reactions moved the address, the fifth and sixth were ignored
    expect(dev.identicalClaimReactions).toBe(4)
    expect(dev.address).toBe(seen[4])
    expect(dev.address).toBe(seen[5])
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('giving up'))
  })

  test('differing NAMEs still resolve via normal arbitration', () => {
    const canbus = { sendPGN: jest.fn() }
    dev = new CanDevice(canbus, makeOptions({ uniqueNumber: 12345 }))
    dev.cansend = true
    const before = dev.address

    // higher uniqueNumber -> our claim is smaller -> we defend and stay
    dev.n2kMessage(claimForOwnAddress(dev, { uniqueNumber: 99999 }))

    expect(dev.address).toBe(before)
    expect(canbus.sendPGN).toHaveBeenCalledTimes(1)
  })

  test('cap and suppression reset once the time window rolls over', () => {
    const canbus = { sendPGN: jest.fn() }
    // advancing past the claim-detection timeout fires the checker,
    // which emits on the app — the stub needs an emit
    const app = {
      on: () => undefined,
      removeListener: () => undefined,
      emit: () => undefined
    }
    dev = new CanDevice(canbus, makeOptions({ app, uniqueNumber: 613748 }))
    dev.cansend = true

    for (let i = 0; i < 6; i++) {
      dev.n2kMessage(claimForOwnAddress(dev))
    }
    expect(dev.identicalClaimReactions).toBe(4)
    expect(dev.identicalClaimSuppressed).toBe(true)

    jest.advanceTimersByTime(61 * 1000)

    const before = dev.address
    dev.n2kMessage(claimForOwnAddress(dev))
    // a fresh window reacts (and can report) again
    expect(dev.address).not.toBe(before)
    expect(dev.identicalClaimReactions).toBe(1)
    expect(dev.identicalClaimSuppressed).toBe(false)
  })

  test('caller-supplied addressClaim without a uniqueNumber still re-randomizes', () => {
    // The constructor backfills a uniqueNumber into a caller-supplied
    // claim that carries none — that value came from persistence or a
    // random draw, not user intent, so conflict handling may replace it.
    const { savePersistedData } = jest.requireMock('./persist')
    savePersistedData.mockClear()
    const canbus = { sendPGN: jest.fn() }
    dev = new CanDevice(
      canbus,
      makeOptions({ addressClaim: {}, uniqueNumber: undefined })
    )
    dev.cansend = true

    dev.n2kMessage(claimForOwnAddress(dev))

    const calls = savePersistedData.mock.calls.filter(
      (c: unknown[]) => c[2] === 'uniqueNumber'
    )
    expect(calls.length).toBe(2)
    expect((dev.addressClaim as any).fields.uniqueNumber).toBe(calls[1][3])
  })
})
