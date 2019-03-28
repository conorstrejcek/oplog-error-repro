import { Meteor } from 'meteor/meteor';
import { MongoInternals } from "meteor/mongo";
const Containers = new Meteor.Collection('containers');
const InventoryItems = new Meteor.Collection('inventory-items');
const MongoClient = MongoInternals.defaultRemoteCollectionDriver().mongo.client;

const resetDatabase = async () => {
    // When NUM_CHILD_CONTAINERS > 2, error occurs
    const NUM_CHILD_CONTAINERS = 3;
    if (Containers.find().count() > 0) {
        await Containers.rawCollection().drop();
    }
    if (InventoryItems.find().count() > 0) {
        await InventoryItems.rawCollection().drop();
    }
    const mixedContents = {
        _id: "mixed-contents",
        history: [
            {
                parentContainerIds: [
                    "root-container"
                ]
            }
        ]
    };
    Containers.insert(mixedContents);
    const productionLot = {
        _id: "production-lot",
        history: [
            {
                parentContainerIds: [
                    "root-container"
                ]
            }
        ]
    };
    Containers.insert(productionLot);
    const containerIds = Array(NUM_CHILD_CONTAINERS).fill(1).map((val, index) => String(index + 1));
    containerIds.forEach(_id => {
        const container = {
            _id,
            history: [
                {
                    parentContainerIds: [
                        "mixed-contents",
                        "root-container"
                    ]
                }
            ]
        };
        Containers.insert(container);
        const inventory = {
            history: [
                {
                    parentContainerIds: [
                        _id,
                        "mixed-contents",
                        "root-container"
                    ]
                }
            ]
        };
        InventoryItems.insert(inventory);
    });
};

Meteor.startup(() => {
    // code to run on server at startup
    resetDatabase();
});

const generateHistoryUpdate = ({
   _id = x`_id`,
   parentContainerIds = x`parentContainerIds`
}) => {
    return {
        _id,
        update: {
            $push: {
                history: {
                    $each: [
                        {
                            parentContainerIds
                        }
                    ],
                    $position: 0
                }
            }
        }
    };
};

const generateMoveContainerUpdates = ({
    sourceContainer,
    sourceChildren,
    sourceInventoryItems,
    destinationContainer
}) => {
    // sort children in order they will be updated
    sourceChildren.sort((a, b) => {
        return (
            a.history[0].parentContainerIds.indexOf(sourceContainer._id) -
            b.history[0].parentContainerIds.indexOf(sourceContainer._id)
        );
    });
    const sortedContainers = [sourceContainer].concat(sourceChildren);
    // take the `parents` of destinationContainer
    // add `destinationContainerId` to the first index
    const newBaseParents = [destinationContainer._id].concat(destinationContainer.history[0].parentContainerIds);
    let inventoryItemUpdates = [];
    // Calculate new parents by splicing new base parents into the previous location of the source container
    sortedContainers.forEach((container, index) => {
        if (index === 0) {
            container.history[0].parentContainerIds = newBaseParents;
        } else {
            // Slice newBaseParents after the sourceContainer._id
            const sourceContainerIndex = container.history[0].parentContainerIds.indexOf(sourceContainer._id);
            const sliced = container.history[0].parentContainerIds.slice(0, sourceContainerIndex + 1);
            container.history[0].parentContainerIds = sliced.concat(newBaseParents);
        }
        // Check if any inventory items have this container as a parent
        sourceInventoryItems.forEach(item => {
            if (item.history[0].parentContainerIds[0] === container._id) {
                inventoryItemUpdates.push(
                    generateHistoryUpdate({
                        _id: item._id,
                        parentContainerIds: [container._id].concat(container.history[0].parentContainerIds)
                    })
                );
            }
        });
    });
    return {
        containerUpdates: sortedContainers.map(container => {
            return generateHistoryUpdate({
                _id: container._id,
                parentContainerIds: container.history[0].parentContainerIds
            });
        }),
        inventoryItemUpdates
    };
};

Meteor.publish('test-publication', () => {
    return InventoryItems.find({
        'history.0.parentContainerIds': 'production-lot'
    });
});

Meteor.methods({
    async 'update-documents'() {
        console.log('\nupdate-documents() called');
        const sourceContainer = Containers.findOne('mixed-contents');
        const sourceChildren = Containers.find(
            {
                'history.0.parentContainerIds': 'mixed-contents',
            }
        ).fetch();
        const sourceInventoryItems = InventoryItems.find(
            {
                'history.0.parentContainerIds': 'mixed-contents',
            }
        ).fetch();
        const destinationContainer = Containers.findOne('production-lot');
        const { containerUpdates, inventoryItemUpdates } = generateMoveContainerUpdates({
            sourceContainer,
            sourceChildren,
            sourceInventoryItems,
            destinationContainer
        });
        // console.log(JSON.stringify({ containerUpdates, inventoryItemUpdates }, null, 2));
        // Run Transaction
        console.log('starting mongo session...');
        const session = await MongoClient.startSession();
        try {
            console.log('starting transaction...');
            await session.startTransaction();
            for (let i = 0; i < containerUpdates.length; i++) {
                const { _id, update } = containerUpdates[i];
                await Containers.rawCollection().updateOne({ _id }, update, { session });
            }
            for (let i = 0; i < inventoryItemUpdates.length; i++) {
                const { _id, update } = inventoryItemUpdates[i];
                await InventoryItems.rawCollection().updateOne({ _id }, update, { session });
            }
            console.log('committing transaction...');
            await session.commitTransaction();
            console.log('transaction complete!');
        } catch (e) {
            console.error('there was a problem with the transaction: ', e);
            session.abortTransaction();
        } finally {
            session.endSession();
        }
        console.log('update-documents() finished');
    },
    async 'reset-database'() {
        console.log('\nresetting database...');
        await resetDatabase();
        console.log('database reset!');
    }
});