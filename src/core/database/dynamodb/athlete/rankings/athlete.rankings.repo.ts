import { Injectable } from '@nestjs/common';
import { DocumentClient } from 'aws-sdk/clients/dynamodb';
import { IDynamoDBService } from 'core/aws/aws.services.interface';
import * as moment from 'moment';
import { DDBRepository, GlobalSecondaryIndexName } from '../../dynamodb.repo';
import { GSILastEvaluatedKey } from '../../interfaces/table.interface';
import { logDynamoDBError, logThrowDynamoDBError } from '../../utils/utils';
import {
  AllAttrs,
  DDBAthleteRankingsItem,
  DDBAthleteRankingsItemPrimaryKey,
  DDBRankingsItemPrimaryKey,
} from './athlete.rankings.interface';
import { AttrsTransformer } from './transformers/attributes.transformers';
import { EntityTransformer } from './transformers/entity.transformer';

@Injectable()
export class DDBAthleteRankingsRepository extends DDBRepository {
  protected readonly _tableName = 'ISA-Rankings';
  private readonly transformer = new AttrsTransformer();
  public readonly entityTransformer = new EntityTransformer();

  constructor(dynamodbService: IDynamoDBService) {
    super(dynamodbService);
  }

  public async get(pk: DDBAthleteRankingsItemPrimaryKey) {
    const params: DocumentClient.GetItemInput = {
      TableName: this._tableName,
      Key: this.transformer.primaryKey(pk.athleteId, pk.year, pk.discipline, pk.gender, pk.ageCategory),
    };
    return this.client
      .get(params)
      .promise()
      .then(data => {
        if (data.Item) {
          return this.transformer.transformAttrsToItem(data.Item as AllAttrs);
        }
        return null;
      })
      .catch<null>(err => {
        logDynamoDBError('DDBAthleteRankingsRepository get', err, params);
        return null;
      });
  }

  public async put(item: DDBAthleteRankingsItem) {
    const params = {
      TableName: this._tableName,
      Item: this.transformer.transformItemToAttrs(item),
    };
    return this.client
      .put(params)
      .promise()
      .then(data => data)
      .catch(logThrowDynamoDBError('DDBAthleteRankingsRepository Put', params));
  }

  public async updatePoints(pk: DDBAthleteRankingsItemPrimaryKey, points: number) {
    const params: DocumentClient.UpdateItemInput = {
      TableName: this._tableName,
      Key: this.transformer.primaryKey(pk.athleteId, pk.year, pk.discipline, pk.gender, pk.ageCategory),
      UpdateExpression: 'SET #gsi_sk = :points, #lastUpdatedAt = :unixTime',
      ConditionExpression: 'attribute_exists(#pk)',
      ExpressionAttributeNames: {
        '#pk': this.transformer.attrName('PK'),
        '#gsi_sk': this.transformer.attrName('GSI_SK'),
        '#lastUpdatedAt': this.transformer.attrName('lastUpdatedAt'),
      },
      ExpressionAttributeValues: {
        ':unixTime': moment().unix(),
        ':points': this.transformer.itemToAttrsTransformer.GSI_SK(points),
      },
      ReturnValues: 'UPDATED_NEW',
    };
    return this.client
      .update(params)
      .promise()
      .then(data => {
        return data.Attributes[this.transformer.attrName('GSI_SK')] as number;
      })
      .catch(logThrowDynamoDBError('DDBAthleteRankingsRepository addPoints', params));
  }

  public async queryRankings(
    limit: number,
    category: DDBRankingsItemPrimaryKey,
    opts: {
      after?: {
        athleteId: string;
        points: number;
      };
      filter?: { country?: string; id?: string };
    } = {},
  ) {
    const exclusiveStartKey = this.createGSIExclusiveStartKey(category, opts.after);
    const { filterExpression, filterExpAttrNames, filterExpAttrValues } = this.createFilterExpression(opts.filter);

    const params: AWS.DynamoDB.DocumentClient.QueryInput = {
      TableName: this._tableName,
      IndexName: GlobalSecondaryIndexName,
      Limit: limit,
      ScanIndexForward: false,
      ExclusiveStartKey: exclusiveStartKey,
      KeyConditionExpression: '#sk_gsi = :sk_gsi ',
      FilterExpression: filterExpression,
      ExpressionAttributeNames: {
        '#sk_gsi': this.transformer.attrName('SK_GSI'),
        ...filterExpAttrNames,
      },
      ExpressionAttributeValues: {
        ':sk_gsi': this.transformer.itemToAttrsTransformer.SK_GSI(
          category.year,
          category.discipline,
          category.gender,
          category.ageCategory,
        ),
        ...filterExpAttrValues,
      },
    };
    return this.client
      .query(params)
      .promise()
      .then(data => {
        const items = data.Items.map((item: AllAttrs) => {
          return this.transformer.transformAttrsToItem(item);
        });
        return { items: items, lastKey: this.extractGSILastEvaluatedKey(data.LastEvaluatedKey as GSILastEvaluatedKey) };
      })
      .catch(logThrowDynamoDBError('DDBAthleteRankingsRepository queryRankings', params));
  }

  private extractGSILastEvaluatedKey(lastEvaluatedKey: GSILastEvaluatedKey) {
    let lastKey: any;
    if (lastEvaluatedKey) {
      lastKey = {
        athleteId: this.transformer.attrsToItemTransformer.athleteId(lastEvaluatedKey.PK),
        points: this.transformer.attrsToItemTransformer.points(lastEvaluatedKey.GSI_SK),
      };
    }
    return lastKey;
  }

  private createGSIExclusiveStartKey(
    category: DDBRankingsItemPrimaryKey,
    after?: { athleteId: string; points: number },
  ) {
    let startKey: GSILastEvaluatedKey;
    if (after && after.athleteId && after.points) {
      startKey = {
        PK: this.transformer.itemToAttrsTransformer.PK(after.athleteId),
        SK_GSI: this.transformer.itemToAttrsTransformer.SK_GSI(
          category.year,
          category.discipline,
          category.gender,
          category.ageCategory,
        ),
        GSI_SK: this.transformer.itemToAttrsTransformer.GSI_SK(after.points),
      };
    }
    return startKey;
  }

  private createFilterExpression(filter: { country?: string; id?: string }) {
    let filterExpression = '';
    const filterExpAttrNames = {};
    const filterExpAttrValues = {};

    if (!filter) {
      return { filterExpression: undefined, filterExpAttrNames, filterExpAttrValues };
    }
    if (filter.country) {
      filterExpression = (filterExpression ? filterExpression + ' and ' : '') + `contains(#country, :country)`;
      filterExpAttrNames['#country'] = this.transformer.attrName('country');
      filterExpAttrValues[':country'] = filter.country;
    }
    if (filter.id) {
      filterExpression = (filterExpression ? filterExpression + ' and ' : '') + `contains(#pk, :id)`;
      filterExpAttrNames['#pk'] = this.transformer.attrName('PK');
      filterExpAttrValues[':id'] = filter.id;
    }
    return {
      filterExpression: filterExpression || undefined,
      filterExpAttrNames,
      filterExpAttrValues,
    };
  }
}
