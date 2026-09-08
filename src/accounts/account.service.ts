import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Account } from './account.entity'
import { Repository } from 'typeorm'

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
  ) {}

  async transfer(
    fromId: string,
    toId: string,
    amount: number,
  ): Promise<TransferResult> {
    if (fromId === toId) {
      throw new BadRequestException('Cannot do a self transfer')
    }

    const from = await this.accountsRepo.findOne({ where: { id: fromId } })
    const to = await this.accountsRepo.findOne({ where: { id: toId } })

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
      await this.accountsRepo.save(from)
      await this.accountsRepo.save(to)

      return {
        fromAccountId: fromId,
        toAccountId: toId,
        amountCents: amount,
        fromBalanceCents,
        toBalanceCents,
      }
    } catch {
      throw new BadRequestException('Cannot transfer')
    }
  }
}
