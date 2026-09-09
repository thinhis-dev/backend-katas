import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm'
import { Account } from './account.entity'
import { DataSource, Repository } from 'typeorm'

type TransferResult = {
  fromAccountId: string
  toAccountId: string
  amountCents: number
  fromBalanceCents: number
  toBalanceCents: number
}

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private readonly accountsRepo: Repository<Account>,

    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async transfer(
    fromId: string,
    toId: string,
    amount: number,
  ): Promise<TransferResult> {
    if (fromId === toId) {
      throw new BadRequestException('Cannot do a self transfer')
    }

    return this.dataSource.transaction(async (manager) => {
      // const from = await this.accountsRepo.findOne({ where: { id: fromId } })
      // const to = await this.accountsRepo.findOne({ where: { id: toId } })

      let from
      let to

      if (fromId > toId) {
        from = await manager
          .getRepository(Account)
          .createQueryBuilder('account')
          .setLock('pessimistic_write')
          .where('account.id = :fromId', { fromId })
          .getOne()

        to = await manager
          .getRepository(Account)
          .createQueryBuilder('account')
          .setLock('pessimistic_write')
          .where('account.id = :toId', { toId })
          .getOne()
      } else {
        to = await manager
          .getRepository(Account)
          .createQueryBuilder('account')
          .setLock('pessimistic_write')
          .where('account.id = :toId', { toId })
          .getOne()

        from = await manager
          .getRepository(Account)
          .createQueryBuilder('account')
          .setLock('pessimistic_write')
          .where('account.id = :fromId', { fromId })
          .getOne()
      }

      if (!from || !to) {
        throw new NotFoundException('Cannot find account from or to')
      }

      if (amount > from.balanceCents) {
        throw new ConflictException('Cannot transfer more than the balance')
      }

      const fromBalanceCents = from.balanceCents - amount
      const toBalanceCents = to.balanceCents + amount

      from.balanceCents = fromBalanceCents
      to.balanceCents = toBalanceCents

      try {
        await manager.save(from)
        await manager.save(to)

        return {
          fromAccountId: fromId,
          toAccountId: toId,
          amountCents: amount,
          fromBalanceCents,
          toBalanceCents,
        }
      } catch {
        // TODO: bad request exception for all the errors is BAD => @Catch(QueryFailError)
        throw new BadRequestException('Cannot transfer')
      }
    })
  }
}
