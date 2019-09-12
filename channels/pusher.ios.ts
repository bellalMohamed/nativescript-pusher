import { InternalPusherEvents, TNSPusherBase, TNSPusherChannelBase, TNSPusherConnectionBase } from './pusher.common';
import { Options } from './interfaces';
import { ConnectionStatus } from './enums';
import { deserialize } from './helper';

export * from './interfaces';
export * from './enums';

export class TNSPusher extends TNSPusherBase {
    ios: Pusher;
    private readonly _delegate: any;
    private _globalEvents: Map<Function, string>;

    constructor(apiKey: string, options?: Options) {
        super();
        this._globalEvents = new Map<Function, string>();
        this._delegate = PusherDelegateImpl.initWithOwner(new WeakRef(this));
        if (options) {
            let authEndpoint = OCAuthMethod.alloc().initWithType(4);
            let host = null;
            if (options.cluster) {
                host = OCPusherHost.alloc().initWithCluster(options.cluster);
            }

            if (options.host) {
                host = OCPusherHost.alloc().initWithHost(options.host);
            }
            const opts = PusherClientOptions.alloc().initWithOcAuthMethodAttemptToReturnJSONObjectAutoReconnectOcHostPortEncryptedActivityTimeout(
                authEndpoint,
                false,
                !!options.autoReconnect,
                host,
                options.port,
                !!options.encrypted,
                options.activityTimeout
            );
            this.ios = Pusher.alloc().initWithAppKeyOptions(apiKey, opts);
        } else {
            this.ios = Pusher.alloc().initWithKey(apiKey);
        }

        this.ios.delegate = this._delegate;
    }

    connect(): void {
        this.ios.connect();
    }

    disconnect(): void {
        this.ios.disconnect();
    }

    private _connection: TNSPusherConnection;

    public get connection() {
        if (!this._connection) {
            this._connection = new TNSPusherConnection(this.ios);
        }
        return this._connection;
    }

    bind(callback: Function) {
        const id = this.ios.bind((data) => {
            callback(deserialize(data));
        });
        this._globalEvents.set(callback, id);
        return this;
    }

    unbind(callback: Function) {
        const id = this._globalEvents.get(callback);
        if (id) {
            this.ios.unbindWithCallbackId(id);
            this._globalEvents.delete(callback);
        }
    }

    subscribe(event: string) {
        const channel = this.ios.subscribeWithChannelNameOnMemberAddedOnMemberRemoved(event, p1 => {
        }, p1 => {
        });
        return new TNSPusherChannel(channel);
    }

    unsubscribeAll(): void {
        this.ios.unsubscribeAll();
    }

    unsubscribe(channelName: string): void {
        this.ios.unsubscribe(channelName);
    }
}

export class TNSPusherChannel extends TNSPusherChannelBase {
    ios: PusherChannel;
    connection: any;
    private _channelEvents: Map<Function, string>;

    constructor(instance: any) {
        super();
        this._channelEvents = new Map<Function, string>();
        this.ios = instance;
    }

    bind(event: string, callback: Function) {
        const sig = this.ios.methodSignatureForSelector('bindWithEventName:callback:');
        const invocation = NSInvocation.invocationWithMethodSignature(sig);
        invocation.target = this.ios;
        invocation.selector = 'bindWithEventName:callback:';
        const eventRef = new interop.Reference(interop.types.id, event);
        const callbackRef = new interop.Reference(interop.types.void, (data) => {
            console.log('called');
            // console.log(deserialize(data));
            // callback(deserialize(data));
        });
        invocation.setArgumentAtIndex(eventRef, 2);
        invocation.setArgumentAtIndex(callbackRef, 3);
        invocation.invoke();
        const ret = new interop.Reference(interop.types.id, new interop.Pointer());
        invocation.getReturnValue(ret);
        this._channelEvents.set(callback, ret.value);
    }

    unbind(event: string, callback: Function) {
        const sig = this.ios.methodSignatureForSelector('unbindWithEventName:callbackId:');
        const invocation = NSInvocation.invocationWithMethodSignature(sig);
        invocation.selector = 'unbindWithEventName:callbackId:';
        const eventRef = new interop.Reference(interop.types.id, event);
        invocation.setArgumentAtIndex(eventRef, 2);
        const id = this._channelEvents.get(callback);
        if (id) {
            const idRef = new interop.Reference(interop.types.void, id);
            invocation.setArgumentAtIndex(idRef, 3);
            invocation.invokeWithTarget(this.ios);
            this._channelEvents.delete(callback);
        }
    }

}

export class TNSPusherConnection extends TNSPusherConnectionBase {
    ios: Pusher;
    _state: any;
    private events: Map<Function, string>;

    constructor(instance: any) {
        super();
        this.ios = instance;
        this.events = new Map<Function, string>();
    }

    bind(event: string, callback: Function) {
        const id = this.ios.bind((data) => {
            if (data) {
                const nativeEvent = data.objectForKey('event');
                if (event === 'error' && nativeEvent === InternalPusherEvents.Error) {
                    callback(deserialize(data));
                    this.events.set(callback, id);
                }
                if (event === 'ping' && nativeEvent === InternalPusherEvents.Ping) {
                    callback('ping');
                    this.events.set(callback, id);
                }

                if (event === 'pong' && nativeEvent === InternalPusherEvents.Pong) {
                    callback('pong');
                    this.events.set(callback, id);
                }
            }
        });
    }

    unbind(event: string, callback?: Function) {
        const id = this.events.get(callback);
        if (id) {
            this.ios.unbindWithCallbackId(id);
            this.events.delete(callback);
        }
    }

    get state() {
        return this._state;
    }

}

@ObjCClass(PusherDelegate)
class PusherDelegateImpl extends NSObject implements PusherDelegate {
    _owner: WeakRef<TNSPusher>;

    public static initWithOwner(owner: WeakRef<TNSPusher>) {
        const delegate = PusherDelegateImpl.new() as PusherDelegateImpl;
        delegate._owner = owner;
        return delegate;
    }

    private static _getState(state: ConnectionState) {
        switch (state) {
            case ConnectionState.Connected:
                return ConnectionStatus.CONNECTED;
            case ConnectionState.Connecting:
                return ConnectionStatus.CONNECTING;
            case ConnectionState.Disconnecting:
                return ConnectionStatus.DISCONNECTING;
            case ConnectionState.Reconnecting:
                return ConnectionStatus.RECONNECTING;
            default:
                return ConnectionStatus.DISCONNECTED;
        }
    }

    changedConnectionStateFromTo(old: ConnectionState, new_: ConnectionState): void {
        const owner = this._owner.get();
        if (owner) {
            owner.connection._state = PusherDelegateImpl._getState(new_);
        }
    }

    debugLogWithMessage(message: string): void {
    }

    failedToSubscribeToChannelWithNameResponseDataError(name: string, response: NSURLResponse, data: string, error: NSError): void {
        const owner = this._owner.get();
    }

    subscribedToChannelWithName(name: string): void {
        const owner = this._owner.get();
        /* if (name.startsWith('presence-')) {
             if (owner.presenceChannelsCallback.has(name)) {
                 const callback = owner.presenceChannelsCallback.get(name);
                 if (callback) {
                     callback(null, {
                         channel: name,
                         users: [] // channel.members
                     });
                 }
             }
         } else {
             if (owner.channelsCallback.has(name)) {
                 const callback = owner.channelsCallback.get(name);
                 if (callback) {
                     callback(null, {channelName: name});
                 }
             }
         }
         */
    }
}