import 'ioredis'

declare module 'ioredis' {
  interface RedisCommander<Context> {
    increaseWithExpiration(
      key: string,
      windowSeconds: number | string,
    ): Promise<number[]>
  }
}
