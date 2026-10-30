import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({auth:{isAuthenticated:true,phoneNumber:'account-a' as string|null},files:[] as unknown[],media:vi.fn(),edit:vi.fn()}));
vi.mock('./device',()=>({androidMedia:true,mediaCommand:mocks.media,useDeviceStore:{getState:()=>({metadata:{},edit:mocks.edit})}}));
vi.mock('@/stores/authStore',()=>({useAuthStore:{getState:()=>mocks.auth}}));
vi.mock('@/stores/fileStore',()=>({useFileStore:{getState:()=>({files:mocks.files,bootstrapComplete:true,isSyncing:false})}}));
vi.mock('@/lib/upload/uploadManager',()=>({processQueue:vi.fn()}));
import {backupLocalPhoto,runPhotoBackup,usePhotoBackup} from './backup';
import type {TeleFile} from '../types';
const photo:TeleFile={id:'local',name:'photo.jpg',mime:'image/jpeg',size:100,messageId:0,channelId:'',folderPath:'/',uploadedAt:1,localUri:'content://media/external/images/media/1',deviceSourceKey:'device-a'};
beforeEach(()=>{
  mocks.auth.isAuthenticated=true;mocks.auth.phoneNumber='account-a';mocks.files=[];mocks.media.mockReset();mocks.edit.mockReset();
  usePhotoBackup.setState({running:false,cancel:false,error:'',status:'',completed:0,skipped:0});
});
describe('backup boundaries',()=>{
  it('does not access the original when the account changed',async()=>{
    await expect(backupLocalPhoto(photo,'account-b')).rejects.toThrow('cuenta cambió');
    expect(mocks.media).not.toHaveBeenCalled();
  });
  it('skips a known source without copying or uploading it again',async()=>{
    mocks.files=[{...photo,id:'remote',messageId:4}];
    expect(await backupLocalPhoto(photo,'account-a')).toBe(false);
    expect(mocks.media).not.toHaveBeenCalled();
  });
  it('does not stage or upload media on a metered connection with Wi-Fi-only enabled',async()=>{
    mocks.media.mockResolvedValue({online:true,unmetered:false});
    await runPhotoBackup([photo]);
    expect(mocks.media.mock.calls.map(call=>call[0])).toEqual(['networkStatus']);
    expect(usePhotoBackup.getState().error).toContain('Wi-Fi');
  });
  it('removes the temporary original if the account changes while preparing it',async()=>{
    mocks.media.mockImplementation(async(command:string)=>{
      if(command==='prepare'){mocks.auth.phoneNumber='account-b';return {path:'/cache/temp',contentHash:'hash',size:100};}
      return {};
    });
    await expect(backupLocalPhoto(photo,'account-a')).rejects.toThrow('cuenta cambió');
    expect(mocks.media).toHaveBeenLastCalledWith('release',{path:'/cache/temp'});
  });
  it('skips identical content from another source and releases its temporary file',async()=>{
    mocks.files=[{...photo,id:'remote',deviceSourceKey:'another-source',contentHash:'hash',messageId:4}];
    mocks.media.mockResolvedValue({path:'/cache/temp',contentHash:'hash',size:100});
    expect(await backupLocalPhoto(photo,'account-a')).toBe(false);
    expect(mocks.edit).toHaveBeenCalledWith(['device-a'],{contentHash:'hash'});
    expect(mocks.media).toHaveBeenLastCalledWith('release',{path:'/cache/temp'});
  });
});
