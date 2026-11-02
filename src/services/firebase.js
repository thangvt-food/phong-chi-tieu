import { getApp, getApps, initializeApp } from '@firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from '@firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyCVItdxUO9fvS_JlgYlv-PKZjgbc15BFy4',
  authDomain: 'ant05-efa02.firebaseapp.com',
  projectId: 'ant05-efa02',
  appId: '1:314608297930:web:33f530a65ab14400d0d133',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  return {
    idToken: await result.user.getIdToken(),
    email: result.user.email || '',
    displayName: result.user.displayName || '',
  };
}

export function signOutGoogle() {
  return signOut(auth);
}
