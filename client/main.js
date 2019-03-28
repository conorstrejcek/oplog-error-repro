import { Meteor } from 'meteor/meteor';
import React from 'react';
import { render } from 'react-dom';
import { withTracker } from 'meteor/react-meteor-data';
const InventoryItems = new Meteor.Collection('inventory-items');

class HelloWorld extends React.Component {
    render() {
        return (
            <div>
                <button onClick={this.resetDatabase}>Reset Database</button>
                {this.props.inventoryItems.length === 0 && (
                    <button onClick={this.triggerError}>Trigger Error</button>
                )}
                <h2>Published documents</h2>
                <h3>Inventory Items</h3>
                {this.props.inventoryItems.map(item => <pre key={item._id}>{JSON.stringify(item, null, 2)}</pre>)}
            </div>
        );
    }

    triggerError = () => {
        Meteor.call('update-documents');
    };

    resetDatabase = () => {
        Meteor.call('reset-database');
    };
}

const HelloWorldWithTracker = withTracker(() => {
    Meteor.subscribe('test-publication');
    const inventoryItems = InventoryItems.find().fetch();
    return {
        inventoryItems
    };
})(HelloWorld);

Meteor.startup(() => render(<HelloWorldWithTracker />, document.getElementById('app')));