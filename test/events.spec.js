import { deepStrictEqual, strictEqual } from 'assert'
import rimraf from 'rimraf'
import * as Log from '../src/log.js'
import IdentityProvider from 'orbit-db-identity-provider'
import Keystore from '../src/Keystore.js'

import EventStore from '../src/events.js'
import Database from '../src/database.js'

// Test utils
import { config, testAPIs, startIpfs, stopIpfs, getIpfsPeerId, waitForPeers } from 'orbit-db-test-utils'
import connectPeers from './utils/connect-nodes.js'
import { identityKeys, signingKeys } from './fixtures/orbit-db-identity-keys.js'

const { sync: rmrf } = rimraf
const { createIdentity } = IdentityProvider

Object.keys(testAPIs).forEach((IPFS) => {
  describe('Events Database (' + IPFS + ')', function () {
    this.timeout(config.timeout * 2)

    let ipfsd1, ipfsd2
    let ipfs1, ipfs2
    let keystore, signingKeystore
    let peerId1, peerId2
    let testIdentity1, testIdentity2
    let kv1, kv2

    const databaseId = 'events-AAA'

    before(async () => {
      // Start two IPFS instances
      ipfsd1 = await startIpfs(IPFS, config.daemon1)
      ipfsd2 = await startIpfs(IPFS, config.daemon2)
      ipfs1 = ipfsd1.api
      ipfs2 = ipfsd2.api

      await connectPeers(ipfs1, ipfs2)

      // Get the peer IDs
      peerId1 = await getIpfsPeerId(ipfs1)
      peerId2 = await getIpfsPeerId(ipfs2)

      keystore = new Keystore('./keys_1')
      await keystore.open()
      for (const [key, value] of Object.entries(identityKeys)) {
        await keystore.addKey(key, value)
      }

      signingKeystore = new Keystore('./keys_2')
      await signingKeystore.open()
      for (const [key, value] of Object.entries(signingKeys)) {
        await signingKeystore.addKey(key, value)
      }

      // Create an identity for each peers
      testIdentity1 = await createIdentity({ id: 'userA', keystore, signingKeystore })
      testIdentity2 = await createIdentity({ id: 'userB', keystore, signingKeystore })
    })

    afterEach(async () => {
      if (kv1) {
        await kv1.drop()
        await kv1.close()
      }
      if (kv2) {
        await kv2.drop()
        await kv2.close()
      }
    })

    after(async () => {
      if (ipfsd1) {
        await stopIpfs(ipfsd1)
      }
      if (ipfsd2) {
        await stopIpfs(ipfsd2)
      }
      if (keystore) {
        await keystore.close()
      }
      if (signingKeystore) {
        await signingKeystore.close()
      }
      if (testIdentity1) {
        rmrf(testIdentity1.id)
      }
      if (testIdentity2) {
        rmrf(testIdentity2.id)
      }
      rmrf('./orbitdb')
      rmrf('./keys_1')
      rmrf('./keys_2')
    })

    describe('using database', () => {
      it('returns all entries in the database', async () => {
        let updateCount = 0
        let syncCount = 0

        const accessController = {
          canAppend: (entry) => entry.identity.id === testIdentity1.id
        }

        const onUpdate = (entry) => {
          updateCount++
        }
        const onSync = (entry) => {
          syncCount++
        }
        const onError = () => {
        }

        kv1 = await EventStore({ OpLog: Log, Database, ipfs: ipfs1, identity: testIdentity1, databaseId, accessController })
        kv2 = await EventStore({ OpLog: Log, Database, ipfs: ipfs2, identity: testIdentity2, databaseId, accessController })

        kv1.events.on('update', onUpdate)
        kv2.events.on('update', onUpdate)
        kv1.events.on('sync', onSync)
        kv2.events.on('sync', onSync)
        kv1.events.on('error', onError)
        kv2.events.on('error', onError)

        strictEqual(kv1.type, 'events')
        strictEqual(kv2.type, 'events')

        await waitForPeers(ipfs1, [peerId2], databaseId)
        await waitForPeers(ipfs2, [peerId1], databaseId)

        // send a garbage message to pubsub to test onError firing
        // await ipfs1.pubsub.publish(databaseId, Uint8Array.from([1, 2, 3, 4, 5]))

        await kv1.add('init')
        await kv1.add(true)
        await kv1.add('hello')
        await kv1.add('friend')
        await kv1.add(12345)
        await kv1.add('empty')
        await kv1.add('')
        await kv1.add('friend33')
        // const hash = await kv1.add('friend33')
        // await kv1.set('init', true)
        // await kv1.set('hello', 'friend')
        // await kv1.del('hello')
        // await kv1.set('hello', 'friend2')
        // await kv1.del('hello')
        // await kv1.set('empty', '')
        // await kv1.del('empty')
        // const hash = await kv1.set('hello', 'friend3')
        // const lastEntry = await kv1.get(hash)

        // const sleep = (time) => new Promise((resolve) => {
        //   setTimeout(() => {
        //     resolve()
        //   }, time)
        // })
        // await sleep(5000) // give some time for ipfs peers to sync

        const waitForAllUpdates = async () => {
          return new Promise((resolve) => {
            const interval = setInterval(() => {
              if (updateCount >= 8 * 2 || syncCount >= 8) {
                clearInterval(interval)
                resolve()
              }
            }, 100)
          })
        }
        await waitForAllUpdates()
        // sync() test
        // console.time('sync')
        // await kv2.sync(lastEntry.bytes)
        // console.timeEnd('sync')

        // await sleep(1000) // give some time for ipfs peers to sync
        // // write access test
        // let errorMessage
        // try {
        //   await kv2.set('hello', 'friend4')
        // } catch (e) {
        //   errorMessage = e.message
        // } finally {
        //   const valueNotUpdated = await kv2.get('hello')
        //   strictEqual(valueNotUpdated, 'friend3')
        //   notStrictEqual(errorMessage, undefined)
        //   strictEqual(errorMessage.startsWith('Could not append entry:\nKey'), true)
        // }

        // all() test
        const all2 = []
        console.time('all2')
        for await (const event of kv2.iterator()) {
          all2.unshift(event)
        }
        console.timeEnd('all2')
        deepStrictEqual(all2, [
          'init',
          true,
          'hello',
          'friend',
          12345,
          'empty',
          '',
          'friend33'
        ])

        const all1 = await kv2.all()
        deepStrictEqual(all1, [
          'init',
          true,
          'hello',
          'friend',
          12345,
          'empty',
          '',
          'friend33'
        ])

        // onError test
        // notStrictEqual(error, undefined)
        // strictEqual(error.message, 'CBOR decode error: too many terminals, data makes no sense')

        // onUpdate test
        strictEqual(updateCount, 8 * 2)
      })
    })

    describe.skip('load database', () => {
      it('returns all entries in the database', async () => {
        let updateCount = 0
        let syncCount = 0

        const accessController = {
          canAppend: (entry) => entry.identity.id === testIdentity1.id
        }

        const onUpdate = (entry) => {
          ++updateCount
        }
        const onSync = (entry) => {
          ++syncCount
        }

        kv1 = await EventStore({ OpLog: Log, Database, ipfs: ipfs1, identity: testIdentity1, databaseId, accessController })
        kv2 = await EventStore({ OpLog: Log, Database, ipfs: ipfs2, identity: testIdentity2, databaseId, accessController })

        kv1.events.on('update', onUpdate)
        kv2.events.on('update', onUpdate)
        kv1.events.on('sync', onSync)
        kv2.events.on('sync', onSync)

        await waitForPeers(ipfs1, [peerId2], databaseId)
        await waitForPeers(ipfs2, [peerId1], databaseId)

        await kv1.add('init')
        await kv1.add(true)
        await kv1.add('hello')
        await kv1.add('friend')
        await kv1.add(12345)
        await kv1.add('empty')
        await kv1.add('')
        await kv1.add('friend33')
        // const hash = await kv1.add('friend33')
        // const lastEntry = await kv1.log.get(hash)

        // const sleep = (time) => new Promise((resolve) => {
        //   setTimeout(() => {
        //     resolve()
        //   }, time)
        // })
        // await sleep(10000) // give some time for ipfs peers to sync
        const waitForAllUpdates = async () => {
          return new Promise((resolve) => {
            const interval = setInterval(() => {
              if (updateCount >= 8 * 2 || syncCount >= 8) {
                clearInterval(interval)
                resolve()
              }
            }, 100)
          })
        }
        await waitForAllUpdates()

        // sync() test
        // console.time('sync')
        // await kv2.sync(lastEntry.bytes)
        // console.timeEnd('sync')

        // await kv1.close()
        // await kv2.close()

        // kv1 = await EventStore({ OpLog: Log, Database, ipfs: ipfs1, identity: testIdentity1, databaseId, accessController })
        // kv2 = await EventStore({ OpLog: Log, Database, ipfs: ipfs2, identity: testIdentity2, databaseId, accessController })

        // all() test
        const all2 = []
        console.time('all2')
        for await (const event of kv2.iterator()) {
          all2.unshift(event)
        }
        console.timeEnd('all2')
        deepStrictEqual(all2, [
          'init',
          true,
          'hello',
          'friend',
          12345,
          'empty',
          '',
          'friend33'
        ])

        const all1 = await kv2.all()
        deepStrictEqual(all1, [
          'init',
          true,
          'hello',
          'friend',
          12345,
          'empty',
          '',
          'friend33'
        ])
      })
    })
  })
})
