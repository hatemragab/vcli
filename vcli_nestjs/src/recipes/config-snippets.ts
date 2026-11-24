/** Selected, dependency-free private configuration validators emitted into core. */
export const privateJsonHelper = `const privateJson=<T extends z.ZodType>(schema:T)=>z.string().max(16384).transform((value,context):z.output<T>=>{let parsed:unknown;try{parsed=JSON.parse(value);}catch{context.addIssue({code:'custom',message:'INVALID_PRIVATE_JSON'});return z.NEVER;}const result=schema.safeParse(parsed);if(!result.success){context.addIssue({code:'custom',message:'INVALID_PRIVATE_JSON'});return z.NEVER;}return result.data;});`;

export const jwtKeyHelper = `const jwtKeySchema=z.strictObject({id:z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),key:z.string().regex(/^[A-Za-z0-9_-]{43}$/).refine(value=>{const key=Buffer.from(value,'base64url');return key.byteLength===32&&key.toString('base64url')===value;}).transform(value=>new Uint8Array(Buffer.from(value,'base64url')))});`;

export const mailKeyHelper = `const mailKeysSchema=z.record(z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),z.string().regex(/^[A-Za-z0-9+/]{43}=$/).refine(value=>{const key=Buffer.from(value,'base64');return key.byteLength===32&&key.toString('base64')===value;})).refine(value=>Object.keys(value).length>=1&&Object.keys(value).length<=8);`;

export const actionOriginHelper = `const actionOriginSchema=z.url().refine(value=>{const url=new URL(value);return url.origin===value&&!url.username&&!url.password&&(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)));});`;

export const actionPolicyGuard = `const continueUrl=new URL(e.FIREBASE_ACTION_CONTINUE_URL);
if(!e.FIREBASE_ACTION_CONTINUE_ORIGINS.includes(continueUrl.origin)||continueUrl.username||continueUrl.password||
(e.FIREBASE_ACTION_LINK_DOMAIN&&(!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+[a-z]{2,63}$/.test(e.FIREBASE_ACTION_LINK_DOMAIN)||/(^|\\.)(web\\.app|firebaseapp\\.com)$/.test(e.FIREBASE_ACTION_LINK_DOMAIN)))||
(e.FIREBASE_ACTION_IOS_BUNDLE_ID&&!/^[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+$/.test(e.FIREBASE_ACTION_IOS_BUNDLE_ID))||
(e.FIREBASE_ACTION_ANDROID_PACKAGE_NAME&&!/^[A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z][A-Za-z0-9_]*)+$/.test(e.FIREBASE_ACTION_ANDROID_PACKAGE_NAME))||
(e.FIREBASE_ACTION_ANDROID_MINIMUM_VERSION&&(!/^\\d{1,10}$/.test(e.FIREBASE_ACTION_ANDROID_MINIMUM_VERSION)||!e.FIREBASE_ACTION_ANDROID_PACKAGE_NAME))||
(e.FIREBASE_ACTION_ANDROID_INSTALL_APP&&!e.FIREBASE_ACTION_ANDROID_PACKAGE_NAME)||
(e.FIREBASE_ACTION_HANDLE_CODE_IN_APP&&!e.FIREBASE_ACTION_IOS_BUNDLE_ID&&!e.FIREBASE_ACTION_ANDROID_PACKAGE_NAME)) throw new ApplicationError('INVALID_FIREBASE_ACTION_POLICY',500);`;
