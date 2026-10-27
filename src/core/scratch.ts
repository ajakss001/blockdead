import { Matrix4, Quaternion, Vector3 } from 'three';

/**
 * Shared temporaries for hot loops. Use only within one synchronous function call;
 * never store references to them.
 */
export const _v1 = new Vector3();
export const _v2 = new Vector3();
export const _v3 = new Vector3();
export const _q1 = new Quaternion();
export const _m1 = new Matrix4();
